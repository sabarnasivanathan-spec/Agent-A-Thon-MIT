import re

from database import get_conn


STOP_WORDS = set(
    """
    the and for that with this from are was were
    have has had not but you your they their them
    which will would can could should about into
    than then there these those what when where who
    whom whose how why also such other more most
    some any each per via its our out use used using
    may might been being between over under after
    before because while during within without very
    just only both either neither
    """.split()
)


def tokens(text):

    words = re.findall(
        r"[a-zA-Z][a-zA-Z'-]{2,}",
        (text or "").lower()
    )


    return [

        word

        for word in words

        if word not in STOP_WORDS

    ]


def retrieve(
    user_id,
    query,
    topic=None,
    topic_id=None,
    limit=6
):

    query_words = set(
        tokens(query)
    )


    if topic:

        query_words.update(
            tokens(topic)
        )


    connection = get_conn()


    rows = connection.execute(
        """
        SELECT *
        FROM materials
        WHERE user_id = ?
        """,
        (user_id,)
    ).fetchall()


    connection.close()


    scored = []


    for row in rows:

        text = row["text"]


        text_words = set(
            tokens(text)
        )


        overlap = len(
            query_words & text_words
        )


        phrase_bonus = 0


        if (
            topic
            and topic.lower()
            in text.lower()
        ):

            phrase_bonus = 2


        score = (
            overlap
            + phrase_bonus
        )


        if score > 0:

            scored.append(
                (
                    score,
                    row
                )
            )


    scored.sort(
        key=lambda item: item[0],
        reverse=True
    )


    return [

        {
            "score": score,

            "subject":
                row["subject_name"],

            "source":
                row["source_name"],

            "text":
                row["text"],

            "topic":
                row["topic_title"]
        }

        for score, row
        in scored[:limit]

    ]