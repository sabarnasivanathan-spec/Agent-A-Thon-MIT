from fastapi import FastAPI
from pydantic import BaseModel

from ai_service import ask_ai

app = FastAPI(
    title="StudySync AI Backend",
    version="1.0.0"
)


class AIRequest(BaseModel):
    prompt: str


@app.get("/")
def home():
    return {
        "message": "StudySync AI backend is running!"
    }


@app.get("/health")
def health():
    return {
        "status": "healthy"
    }


@app.post("/ai/chat")
def ai_chat(request: AIRequest):
    answer = ask_ai(request.prompt)

    return {
        "success": True,
        "answer": answer
    }