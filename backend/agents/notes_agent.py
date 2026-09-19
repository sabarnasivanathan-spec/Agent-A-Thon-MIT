import os
from typing import Any

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


def _get_value(request: Any, *names: str, default: str = ""):
    """
    Gets a value from either a Pydantic request object,
    a dictionary, or a normal Python object.
    """
    for name in names:
        if isinstance(request, dict):
            value = request.get(name)
        else:
            value = getattr(request, name, None)

        if value is not None:
            return value

    return default


def generate_notes(request: Any):
    """
    Generate study notes using OpenAI.

    This function is intentionally flexible so it works with
    different Pydantic schemas used by the frontend/backend.
    """

    topic = _get_value(
        request,
        "topic",
        "title",
        "topic_name",
        "subject",
        default="Study Topic",
    )

    text = _get_value(
        request,
        "text",
        "content",
        "material",
        "notes",
        "source_text",
        default="",
    )

    instructions = _get_value(
        request,
        "instructions",
        "prompt",
        "question",
        default="",
    )

    # ---------------------------------------------------------
    # Check API key
    # ---------------------------------------------------------

    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        return {
            "success": False,
            "error": "OPENAI_API_KEY is not configured.",
            "topic": topic,
            "notes": "",
        }

    if OpenAI is None:
        return {
            "success": False,
            "error": "OpenAI package is not installed. Run: pip install openai",
            "topic": topic,
            "notes": "",
        }

    # ---------------------------------------------------------
    # Prepare material
    # ---------------------------------------------------------

    text = str(text or "").strip()

    if not text:
        text = (
            f"Create useful study notes about the topic: {topic}. "
            "Use clear explanations suitable for a student."
        )

    # Avoid sending an enormous amount of browser material
    # to the API in one request.
    text = text[:30000]

    extra = str(instructions or "").strip()

    prompt = f"""
You are StudySync AI, an educational study assistant.

Create high-quality study notes from the student's material.

Topic:
{topic}

Student material:
{text}

Additional instruction:
{extra if extra else "None"}

Requirements:

1. Start with a short overview.
2. Explain the important concepts clearly.
3. Use headings and bullet points.
4. Define important terms.
5. Include formulas or rules when they appear in the material.
6. Include examples when useful.
7. Highlight points that are likely to matter for revision.
8. Do not invent facts that contradict the supplied material.
9. Keep the notes easy to revise before an exam.
10. End with a short "Quick Revision" section.

Return ONLY the study notes.
"""

    # ---------------------------------------------------------
    # Call OpenAI
    # ---------------------------------------------------------

    try:
        client = OpenAI(api_key=api_key)

        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            input=prompt,
        )

        notes = response.output_text.strip()

        return {
            "success": True,
            "topic": topic,
            "notes": notes,
            "error": None,
        }

    except Exception as e:
        return {
            "success": False,
            "topic": topic,
            "notes": "",
            "error": str(e),
        }


async def generate_notes_async(request: Any):
    """
    Async wrapper if your FastAPI route is async.
    """
    return generate_notes(request)