import re

from database import get_conn


def chunk_text(
    text,
    chunk_size=1800,
    overlap=250
):

    text = re.sub(
        r"\r",
        "",
        text or ""
    ).strip()


    if not text:

        return []


    chunks = []

    start = 0


    while start < len(text):

        end = min(
            len(text),
            start + chunk_size
        )


        piece = text[start:end].strip()


        if piece:

            chunks.append(piece)


        if end >= len(text):

            break


        start = max(
            0,
            end - overlap
        )


    return chunks


def index_materials(
    user_id,
    subjects
):

    connection = get_conn()


    connection.execute(
        "DELETE FROM materials WHERE user_id = ?",
        (user_id,)
    )


    count = 0


    for subject in subjects:

        sources = []


        for file in subject.files:

            if (
                file.status == "ok"
                and file.text.strip()
            ):

                sources.append(
                    (
                        file.name,
                        file.text
                    )
                )


        if subject.paste.strip():

            sources.append(
                (
                    "pasted material",
                    subject.paste
                )
            )


        for source_name, text in sources:

            chunks = chunk_text(text)


            for chunk in chunks:

                connection.execute(
                    """
                    INSERT INTO materials
                    (
                        user_id,
                        subject_id,
                        subject_name,
                        topic_id,
                        topic_title,
                        source_name,
                        text
                    )

                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,

                    (
                        user_id,
                        subject.id,
                        subject.name,
                        None,
                        None,
                        source_name,
                        chunk
                    )
                )


                count += 1


        pyq_sources = []


        for file in subject.pyqFiles:

            if (
                file.status == "ok"
                and file.text.strip()
            ):

                pyq_sources.append(
                    (
                        file.name,
                        file.text
                    )
                )


        if subject.pyqPaste.strip():

            pyq_sources.append(
                (
                    "PYQ pasted material",
                    subject.pyqPaste
                )
            )


        for source_name, text in pyq_sources:

            chunks = chunk_text(text)


            for chunk in chunks:

                connection.execute(
                    """
                    INSERT INTO materials
                    (
                        user_id,
                        subject_id,
                        subject_name,
                        topic_id,
                        topic_title,
                        source_name,
                        text
                    )

                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,

                    (
                        user_id,
                        subject.id,
                        subject.name,
                        None,
                        "PYQ",
                        source_name,
                        chunk
                    )
                )


                count += 1


    connection.commit()

    connection.close()


    return count