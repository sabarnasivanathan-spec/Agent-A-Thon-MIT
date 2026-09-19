from ai_service import (
    SYSTEM_PROMPT,
    call_llm,
    extract_json
)


class QuizAgent:

    name = "quiz_agent"


    async def run(
        self,
        topic,
        context,
        count,
        difficulty
    ):

        material = "\n\n".join(
            chunk["text"]
            for chunk in context
        )


        prompt = f"""
Create {count} multiple-choice questions
about:

{topic}


Difficulty:

{difficulty}


Use only the supplied study material.


STUDY MATERIAL:

{material}


Return JSON:

{{
    "questions": [

        {{
            "question": "question",

            "options": [
                "A",
                "B",
                "C",
                "D"
            ],

            "answer": "correct option",

            "explanation":
                "short explanation"
        }}

    ]
}}
"""


        raw = await call_llm(
            [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )


        result = extract_json(raw)


        if result:

            return result


        return {
            "questions": []
        }


    async def flashcards(
        self,
        topic,
        context,
        count
    ):

        material = "\n\n".join(
            chunk["text"]
            for chunk in context
        )


        prompt = f"""
Create {count} study flashcards
for the topic:

{topic}


Use only this material:

{material}


Return JSON:

{{
    "cards": [

        {{
            "question": "question",
            "answer": "answer"
        }}

    ]
}}
"""


        raw = await call_llm(
            [
                {
                    "role": "system",
                    "content": SYSTEM_PROMPT
                },
                {
                    "role": "user",
                    "content": prompt
                }
            ]
        )


        result = extract_json(raw)


        if result:

            return result


        return {
            "cards": []
        }