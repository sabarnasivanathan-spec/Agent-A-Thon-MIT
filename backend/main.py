from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from database import init_db
from schemas import (
    AskRequest,
    NotesRequest,
    QuizRequest,
    FlashcardsRequest,
    MaterialIndexRequest,
    StudyPlanRequest,
    ProgressRequest,
)
from services.document_service import index_materials
from services.retrieval_service import retrieve
from services.study_service import (
    create_study_plan,
    save_progress,
    get_progress,
)
from agents.orchestrator import StudyAgentOrchestrator


orchestrator = StudyAgentOrchestrator()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="StudySync AI Backend",
    description="Agentic RAG backend for StudySync AI",
    version="1.0.0",
    lifespan=lifespan,
)


app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "app": "StudySync AI",
        "status": "running",
        "docs": "/docs"
    }


@app.get("/api/health")
def health():
    return {
        "status": "ok",
        "service": "studysync-backend"
    }


@app.post("/api/materials/index")
def materials_index(request: MaterialIndexRequest):

    count = index_materials(
        request.user_id,
        request.subjects
    )

    return {
        "success": True,
        "chunks_indexed": count
    }


@app.post("/api/ask")
async def ask(request: AskRequest):

    context = retrieve(
        user_id=request.user_id,
        query=request.question,
        topic=request.topic,
        topic_id=request.topic_id,
        limit=request.top_k
    )

    result = await orchestrator.ask(
        question=request.question,
        context=context,
        topic=request.topic
    )

    return {
        "success": True,
        **result
    }


@app.post("/api/generate-notes")
async def generate_notes(request: NotesRequest):

    context = retrieve(
        user_id=request.user_id,
        query=request.topic,
        topic=request.topic,
        topic_id=request.topic_id,
        limit=request.top_k
    )

    result = await orchestrator.generate_notes(
        topic=request.topic,
        context=context,
        pyqs=request.pyqs
    )

    return {
        "success": True,
        **result
    }


@app.post("/api/generate-quiz")
async def generate_quiz(request: QuizRequest):

    context = retrieve(
        user_id=request.user_id,
        query=request.topic,
        topic=request.topic,
        topic_id=request.topic_id,
        limit=request.top_k
    )

    result = await orchestrator.generate_quiz(
        topic=request.topic,
        context=context,
        count=request.count,
        difficulty=request.difficulty
    )

    return {
        "success": True,
        **result
    }


@app.post("/api/generate-flashcards")
async def generate_flashcards(request: FlashcardsRequest):

    context = retrieve(
        user_id=request.user_id,
        query=request.topic,
        topic=request.topic,
        topic_id=request.topic_id,
        limit=request.top_k
    )

    result = await orchestrator.generate_flashcards(
        topic=request.topic,
        context=context,
        count=request.count
    )

    return {
        "success": True,
        **result
    }


@app.post("/api/study/plan")
async def study_plan(request: StudyPlanRequest):

    result = create_study_plan(request)

    return {
        "success": True,
        **result
    }


@app.post("/api/progress")
def progress(request: ProgressRequest):

    save_progress(request)

    return {
        "success": True
    }


@app.get("/api/progress/{user_id}")
def progress_get(user_id: str):

    return {
        "success": True,
        **get_progress(user_id)
    }