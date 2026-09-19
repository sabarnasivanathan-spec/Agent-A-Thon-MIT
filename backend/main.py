import os
from typing import Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from openai import OpenAI


# ============================================================
# ENVIRONMENT
# ============================================================

load_dotenv()

OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    print("WARNING: OPENAI_API_KEY is not set.")

client = OpenAI(api_key=OPENAI_API_KEY) if OPENAI_API_KEY else None


# ============================================================
# FASTAPI APP
# ============================================================

app = FastAPI(
    title="StudySync AI Backend",
    version="1.0.0"
)


# ============================================================
# CORS
# ============================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ============================================================
# REQUEST MODELS
# ============================================================

class AskRequest(BaseModel):
    question: str


class NotesRequest(BaseModel):
    topic: str
    content: Optional[str] = ""


class QuizRequest(BaseModel):
    topic: str
    content: Optional[str] = ""
    number_of_questions: Optional[int] = 5


class FlashcardRequest(BaseModel):
    topic: str
    content: Optional[str] = ""
    number_of_cards: Optional[int] = 5


# ============================================================
# BASIC ROUTES
# ============================================================

@app.get("/")
def root():
    return {
        "message": "StudySync AI backend is running!",
        "status": "ok"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy",
        "openai_configured": client is not None
    }


# ============================================================
# OPENAI HELPER
# ============================================================

def ask_openai(prompt: str) -> str:

    if client is None:
        raise HTTPException(
            status_code=500,
            detail="OPENAI_API_KEY is missing. Check your .env file."
        )

    try:

        response = client.responses.create(
            model="gpt-5.5",

            instructions=(
                "You are StudySync AI, an educational assistant. "
                "Help students understand their study material clearly. "
                "Be accurate, concise and student-friendly. "
                "Do not invent information that is not supported by "
                "the supplied study material when material is provided. "
                "Use headings, bullets and simple explanations when useful."
            ),

            input=prompt
        )

        return response.output_text

    except Exception as e:

        print("OPENAI ERROR:", str(e))

        raise HTTPException(
            status_code=500,
            detail=f"OpenAI request failed: {str(e)}"
        )


# ============================================================
# ASK AI
# ============================================================

@app.post("/ask")
def ask_ai(request: AskRequest):

    if not request.question.strip():
        raise HTTPException(
            status_code=400,
            detail="Question cannot be empty."
        )

    prompt = f"""
Student question:

{request.question}

Answer the student's question clearly.

If the question is educational:
- Explain the concept simply.
- Give an example when useful.
- Highlight important points.
- Keep the answer suitable for studying.
"""

    answer = ask_openai(prompt)

    return {
        "question": request.question,
        "answer": answer
    }


# ============================================================
# NOTES GENERATOR
# ============================================================

@app.post("/notes")
def generate_notes(request: NotesRequest):

    if not request.topic.strip():
        raise HTTPException(
            status_code=400,
            detail="Topic cannot be empty."
        )

    prompt = f"""
Create structured study notes for the following topic.

TOPIC:
{request.topic}

STUDY MATERIAL:
{request.content}

Instructions:

1. Start with a short overview.
2. Explain the important concepts.
3. Use clear headings.
4. Use bullet points where useful.
5. Include important definitions.
6. Include examples if they are supported or useful.
7. Highlight important facts for revision.
8. End with a short recap.

If study material is provided, base the notes primarily on that
material and do not invent facts that contradict it.
"""

    notes = ask_openai(prompt)

    return {
        "topic": request.topic,
        "notes": notes
    }


# ============================================================
# QUIZ GENERATOR
# ============================================================

@app.post("/quiz")
def generate_quiz(request: QuizRequest):

    if not request.topic.strip():
        raise HTTPException(
            status_code=400,
            detail="Topic cannot be empty."
        )

    number = request.number_of_questions or 5

    number = max(
        1,
        min(number, 20)
    )

    prompt = f"""
Create a multiple-choice quiz for a student.

TOPIC:
{request.topic}

STUDY MATERIAL:
{request.content}

Create exactly {number} questions.

For EVERY question use this format:

Question 1:
<question>

A) <option>
B) <option>
C) <option>
D) <option>

Answer:
<correct option>

Explanation:
<short explanation>

Continue until exactly {number} questions are created.

Questions should test understanding rather than only memorization.

If study material is provided, base the questions primarily on
that material.
"""

    quiz = ask_openai(prompt)

    return {
        "topic": request.topic,
        "number_of_questions": number,
        "quiz": quiz
    }


# ============================================================
# FLASHCARD GENERATOR
# ============================================================

@app.post("/flashcards")
def generate_flashcards(request: FlashcardRequest):

    if not request.topic.strip():
        raise HTTPException(
            status_code=400,
            detail="Topic cannot be empty."
        )

    number = request.number_of_cards or 5

    number = max(
        1,
        min(number, 30)
    )

    prompt = f"""
Create exactly {number} educational flashcards.

TOPIC:
{request.topic}

STUDY MATERIAL:
{request.content}

Use this exact structure:

Card 1
Question: <question>
Answer: <answer>

Card 2
Question: <question>
Answer: <answer>

Continue until exactly {number} cards are created.

Keep questions concise and answers useful for revision.

If study material is provided, base the flashcards primarily
on that material.
"""

    flashcards = ask_openai(prompt)

    return {
        "topic": request.topic,
        "number_of_cards": number,
        "flashcards": flashcards
    }


# ============================================================
# STUDY ASSISTANT
# ============================================================

@app.post("/study")
def study_assistant(request: AskRequest):

    if not request.question.strip():
        raise HTTPException(
            status_code=400,
            detail="Study request cannot be empty."
        )

    prompt = f"""
You are the StudySync AI study assistant.

STUDENT REQUEST:
{request.question}

Help the student understand the requested concept.

Include when appropriate:

- Simple explanation
- Important points
- Example
- Common mistake or misconception
- Short recap

Keep the response clear and easy to revise.
"""

    answer = ask_openai(prompt)

    return {
        "answer": answer
    }


# ============================================================
# STARTUP
# ============================================================

@app.on_event("startup")
async def startup_event():

    print("")
    print("==========================================")
    print("        StudySync AI Backend")
    print("==========================================")
    print(" FastAPI server started")
    print(
        f" OpenAI configured: {client is not None}"
    )
    print(" Endpoints:")
    print("   POST /ask")
    print("   POST /notes")
    print("   POST /quiz")
    print("   POST /flashcards")
    print("   POST /study")
    print("==========================================")
    print("")
@app.post("/ai/notes")
def ai_notes(request: NotesRequest):
    prompt = f"""
Create structured study notes for this topic.

Topic:
{request.topic}

Student material:
{request.content}

Give:
1. Short overview
2. Important key points
3. Important terms and definitions
4. Useful examples
5. Short summary

Return clear student-friendly notes.
"""

    result = ask_openai(prompt)

    return {
        "overview": result,
        "points": [],
        "terms": []
    }


@app.post("/ai/chat")
def ai_chat(request: dict):
    message = request.get("message", "")
    history = request.get("history", [])
    context = request.get("context", {})

    prompt = f"""
You are StudySync AI, an educational study assistant.

Student message:
{message}

Student context:
{context}

Previous conversation:
{history}

Help the student clearly and accurately.

You can help with:
- explaining study topics
- making notes
- quizzes
- previous-year questions
- study planning
- backlog
- exam preparation

Do not invent information that is not supported by the student's material/context.
Return a helpful concise answer.
"""

    result = ask_openai(prompt)

    return {
        "text": result,
        "actions": []
    }


@app.post("/ai/pyq")
def ai_pyq(request: dict):
    papers = request.get("papers", [])
    subject_id = request.get("subjectId", "")

    combined = "\n\n--- PAPER ---\n\n".join(papers)

    prompt = f"""
Analyze these previous-year question papers.

Subject:
{subject_id}

Question papers:
{combined}

Identify:
- repeated topics
- frequently asked questions
- important concepts
- patterns across papers

Give a clear student-friendly analysis.
"""

    result = ask_openai(prompt)

    return {
        "subjectId": subject_id,
        "topics": [],
        "unmatched": [result]
    }


@app.post("/ai/reschedule")
def ai_reschedule(request: dict):
    plan = request.get("plan", {})
    exam = request.get("exam", {})
    extra = request.get("extraMinutesPerDay", 0)

    prompt = f"""
You are a study-planning assistant.

Exam:
{exam}

Current study plan:
{plan}

Extra available minutes per day:
{extra}

Suggest how the student can catch up before the exam.

Give practical scheduling advice.
"""

    result = ask_openai(prompt)

    # The frontend expects placed/left arrays.
    # Keep the existing browser scheduling logic responsible
    # for actually placing sessions.
    return {
        "extra": extra,
        "placed": [],
        "left": [],
        "advice": result
    }