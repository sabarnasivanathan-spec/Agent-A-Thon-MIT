import os
from typing import Any

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None


def _get_value(request: Any, *names: str, default: str = ""):
    for name in names:
        if isinstance(request, dict):
            value = request.get(name)
        else:
            value = getattr(request, name, None)

        if value is not None:
            return value

    return default


def generate_quiz(request: Any):
    """
    Generate a quiz using OpenAI.
    Works with dictionaries as well as Pydantic request objects.
    """

    topic = _get_value(
        request,
        "topic",
        "title",
        "subject",
        "topic_name",
        default="General Knowledge",
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

    number = _get_value(
        request,
        "number",
        "count",
        "num_questions",
        "question_count",
        default="5",
    )

    difficulty = _get_value(
        request,
        "difficulty",
        "level",
        default="medium",
    )

    try:
        number = int(number)
    except (TypeError, ValueError):
        number = 5

    number = max(1, min(number, 20))

    text = str(text or "").strip()

    if not text:
        text = f"Create a quiz about {topic}."

    text = text[:30000]

    api_key = os.getenv("OPENAI_API_KEY")

    if not api_key:
        return {
            "success": False,
            "error": "OPENAI_API_KEY is not configured.",
            "topic": topic,
            "questions": [],
        }

    if OpenAI is None:
        return {
            "success": False,
            "error": "OpenAI package is not installed. Run: pip install openai",
            "topic": topic,
            "questions": [],
        }

    prompt = f"""
You are StudySync AI, an educational quiz generator.

Create a quiz for a student.

Topic:
{topic}

Study material:
{text}

Number of questions:
{number}

Difficulty:
{difficulty}

Return exactly {number} multiple-choice questions.

For every question provide:

Question:
A)
B)
C)
D)
Answer:
Explanation:

Make sure the correct answer is supported by the supplied study material whenever study material is provided.

Do not add unnecessary introductory text.
"""

    try:
        client = OpenAI(api_key=api_key)

        response = client.responses.create(
            model=os.getenv("OPENAI_MODEL", "gpt-4.1-mini"),
            input=prompt,
        )

        quiz = response.output_text.strip()

        return {
            "success": True,
            "topic": topic,
            "questions": quiz,
            "error": None,
        }

    except Exception as e:
        return {
            "success": False,
            "topic": topic,
            "questions": [],
            "error": str(e),
        }


async def generate_quiz_async(request: Any):
    return generate_quiz(request)