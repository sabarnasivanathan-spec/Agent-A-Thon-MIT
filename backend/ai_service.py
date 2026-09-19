import json
import re

import httpx
from fastapi import HTTPException

from config import settings


SYSTEM_PROMPT = """
You are StudySync AI, an AI study assistant.

Your job is to help students learn from their uploaded study material.

IMPORTANT RULES:

1. Use the supplied study material as the primary source.
2. Do not invent facts that are not supported by the material.
3. If the material does not contain enough information, clearly say so.
4. Give clear explanations suitable for an engineering student.
5. Keep answers structured and useful for exam preparation.
"""


def extract_json(text: str):

    text = text.strip()

    try:
        return json.loads(text)

    except Exception:
        pass

    match = re.search(
        r"```json\s*(.*?)\s*```",
        text,
        re.S | re.I
    )

    if match:

        try:
            return json.loads(match.group(1))

        except Exception:
            pass

    match = re.search(
        r"\{.*\}|\[.*\]",
        text,
        re.S
    )

    if match:

        try:
            return json.loads(match.group(0))

        except Exception:
            pass

    return None


async def call_llm(
    messages,
    temperature=0.2
):

    if not settings.openrouter_api_key:

        raise HTTPException(
            status_code=500,
            detail=(
                "OPENROUTER_API_KEY is missing "
                "in backend/.env"
            )
        )

    headers = {

        "Authorization":
            f"Bearer {settings.openrouter_api_key}",

        "Content-Type":
            "application/json",

        "HTTP-Referer":
            settings.app_url,

        "X-Title":
            "StudySync AI"
    }


    payload = {

        "model":
            settings.openrouter_model,

        "messages":
            messages,

        "temperature":
            temperature
    }


    try:

        async with httpx.AsyncClient(
            timeout=90
        ) as client:

            response = await client.post(
                settings.openrouter_url,
                headers=headers,
                json=payload
            )

            response.raise_for_status()

            data = response.json()

            return (
                data["choices"][0]
                ["message"]
                ["content"]
            )


    except httpx.HTTPStatusError as error:

        detail = error.response.text[:1000]

        raise HTTPException(
            status_code=502,
            detail=f"LLM provider error: {detail}"
        )


    except Exception as error:

        raise HTTPException(
            status_code=502,
            detail=f"LLM request failed: {error}"
        )