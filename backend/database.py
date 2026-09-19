import sqlite3
from pathlib import Path


DB_PATH = Path(__file__).resolve().parent / "studysync.db"


def get_conn():

    connection = sqlite3.connect(DB_PATH)

    connection.row_factory = sqlite3.Row

    return connection


def init_db():

    connection = get_conn()

    connection.executescript(
        """
        CREATE TABLE IF NOT EXISTS materials (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id TEXT NOT NULL,

            subject_id TEXT,

            subject_name TEXT,

            topic_id TEXT,

            topic_title TEXT,

            source_name TEXT,

            text TEXT NOT NULL
        );


        CREATE INDEX IF NOT EXISTS idx_material_user

        ON materials(user_id);


        CREATE TABLE IF NOT EXISTS progress (

            id INTEGER PRIMARY KEY AUTOINCREMENT,

            user_id TEXT NOT NULL,

            kind TEXT NOT NULL,

            subject TEXT,

            topic TEXT,

            score REAL,

            total REAL,

            minutes INTEGER DEFAULT 0,

            payload TEXT,

            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        """
    )

    connection.commit()

    connection.close()