from typing import Any, Optional

from pydantic import BaseModel, Field


class MaterialFile(BaseModel):

    id: Optional[str] = None

    name: str = "material"

    text: str = ""

    status: str = "ok"


class SubjectMaterial(BaseModel):

    id: str

    name: str

    paste: str = ""

    pyqPaste: str = ""

    files: list[MaterialFile] = []

    pyqFiles: list[MaterialFile] = []


class MaterialIndexRequest(BaseModel):

    user_id: str

    subjects: list[SubjectMaterial]


class AskRequest(BaseModel):

    user_id: str

    question: str

    topic: Optional[str] = None

    topic_id: Optional[str] = None

    top_k: int = Field(
        default=6,
        ge=1,
        le=15
    )


class NotesRequest(BaseModel):

    user_id: str

    topic: str

    topic_id: Optional[str] = None

    pyqs: list[str] = []

    top_k: int = Field(
        default=8,
        ge=1,
        le=15
    )


class QuizRequest(BaseModel):

    user_id: str

    topic: str

    topic_id: Optional[str] = None

    count: int = Field(
        default=5,
        ge=1,
        le=15
    )

    difficulty: str = "mixed"

    top_k: int = Field(
        default=8,
        ge=1,
        le=15
    )


class FlashcardsRequest(BaseModel):

    user_id: str

    topic: str

    topic_id: Optional[str] = None

    count: int = Field(
        default=8,
        ge=1,
        le=15
    )

    top_k: int = Field(
        default=8,
        ge=1,
        le=15
    )


class StudyPlanRequest(BaseModel):

    user_id: str

    exam_name: str

    exam_date: str

    daily_hours: float = Field(
        default=3,
        gt=0,
        le=12
    )

    start_minute: int = Field(
        default=1080,
        ge=0,
        le=1439
    )

    block_minutes: int = Field(
        default=45,
        ge=20,
        le=120
    )

    topics: list[dict[str, Any]] = []

    off_days: list[int] = []

    revision_share: float = Field(
        default=0.15,
        ge=0,
        le=1
    )


class ProgressRequest(BaseModel):

    user_id: str

    kind: str

    subject: Optional[str] = None

    topic: Optional[str] = None

    score: Optional[float] = None

    total: Optional[float] = None

    minutes: int = 0

    payload: dict[str, Any] = {}
class FlashcardRequest(BaseModel):
    user_id:str 
    topic:str 
    material:str 
    num_cards: int=5