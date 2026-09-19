import json

from datetime import date, timedelta

from database import get_conn


def get_available_days(
    start,
    end,
    off_days
):

    days = []

    current = start


    while current < end:

        if current.weekday() not in off_days:

            days.append(current)


        current += timedelta(days=1)


    if not days:

        days.append(start)


    return days


def create_study_plan(request):

    start_date = date.today()

    exam_date = date.fromisoformat(
        request.exam_date
    )


    days = get_available_days(
        start_date,
        exam_date,
        set(request.off_days)
    )


    topics = request.topics or []


    weighted_topics = []


    for topic in topics:

        weight = 1.0


        if topic.get("difficult"):

            weight *= 1.7


        if topic.get("important"):

            weight *= 1.4


        text_length = len(
            topic.get("text", "")
        )


        weight *= min(
            2.5,
            1 + text_length / 2500
        )


        weighted_topics.append(
            (
                weight,
                topic
            )
        )


    weighted_topics.sort(
        key=lambda item: item[0],
        reverse=True
    )


    sessions = []

    day_index = 0

    minutes_used = 0

    daily_capacity = int(
        request.daily_hours * 60
    )


    for _, topic in weighted_topics:

        required_sessions = max(
            1,
            min(
                4,
                len(
                    topic.get(
                        "text",
                        ""
                    )
                ) // 1800 + 1
            )
        )


        for _ in range(
            required_sessions
        ):

            if (
                minutes_used
                + request.block_minutes
                > daily_capacity
            ):

                day_index += 1

                minutes_used = 0


            if day_index >= len(days):

                break


            sessions.append(
                {

                    "topicId":
                        topic.get("id"),

                    "topicTitle":
                        topic.get("title"),

                    "subjectId":
                        topic.get("subjectId"),

                    "type":
                        "study",

                    "minutes":
                        request.block_minutes,

                    "date":
                        days[
                            day_index
                        ].isoformat(),

                    "start":
                        request.start_minute
                        + minutes_used,

                    "status":
                        "pending"
                }
            )


            minutes_used += (
                request.block_minutes
            )


    return {

        "exam_name":
            request.exam_name,

        "exam_date":
            request.exam_date,

        "sessions":
            sessions,

        "days_available":
            len(days)
    }


def save_progress(request):

    connection = get_conn()


    connection.execute(
        """
        INSERT INTO progress
        (
            user_id,
            kind,
            subject,
            topic,
            score,
            total,
            minutes,
            payload
        )

        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,

        (
            request.user_id,
            request.kind,
            request.subject,
            request.topic,
            request.score,
            request.total,
            request.minutes,
            json.dumps(
                request.payload
            )
        )
    )


    connection.commit()

    connection.close()


def get_progress(user_id):

    connection = get_conn()


    rows = connection.execute(
        """
        SELECT *
        FROM progress
        WHERE user_id = ?
        ORDER BY id DESC
        """,
        (user_id,)
    ).fetchall()


    connection.close()


    return {

        "items":
            [
                dict(row)
                for row in rows
            ],

        "count":
            len(rows)
    }