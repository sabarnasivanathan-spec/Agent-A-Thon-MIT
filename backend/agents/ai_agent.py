import os
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise RuntimeError("OPENAI_API_KEY is missing from .env")

client = OpenAI(api_key=OPENAI_API_KEY)


def ask_openai(prompt: str) -> str:
    response = client.responses.create(
        model="gpt-5.6-luna",
        input=prompt
    )

    return response.output_text


def generate_notes(topic: str, material: str) -> str:
    prompt = f"""
You are an AI study assistant.

Create clear, student-friendly study notes from the material below.

Topic:
{topic}

Material:
{material}

Return:
1. Short overview
2. Key concepts
3. Important definitions
4. Important points to remember
5. A few exam-focused questions

Only use information supported by the supplied material.
"""

    return ask_openai(prompt)


def generate_flashcards(topic: str, material: str) -> str:
    prompt = f"""
Create useful study flashcards from the material below.

Topic:
{topic}

Material:
{material}

Create 8 flashcards.

Format each one as:

Q: question
A: answer

Keep the answers concise and based only on the supplied material.
"""

    return ask_openai(prompt)


def answer_question(question: str, material: str) -> str:
    prompt = f"""
You are a study assistant.

Answer the student's question using the supplied study material.

Question:
{question}

Study material:
{material}

Give a clear explanation suitable for a student.
Do not invent information that is not supported by the material.
"""

    return ask_openai(prompt)