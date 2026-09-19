from ai_service import (
    SYSTEM_PROMPT,
    call_llm,
    extract_json
)


class NotesAgent:

    name = "notes_agent"


    async def run(
        self,
        topic,
        context,
        pyqs
    ):

        material = "\n\n".join(
            chunk["text"]
            for chunk in context
        )


        previous_questions = (

            "\n".join(pyqs)

            if pyqs

            else "None"
        )


        prompt = f"""
Create exam-oriented notes for:

{topic}


Use only the supplied study material.


STUDY MATERIAL:

{material}


PREVIOUS YEAR QUESTIONS:

{previous_questions}


Return JSON:

{{
    "overview": "short overview",

    "points": [
        "important point"
    ],

    "terms": [
        {{
            "term": "term",
            "definition": "definition"
        }}
    ],

    "pyq_focus": [
        "important PYQ focus"
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

            "overview": raw,

            "points": [],

            "terms": [],

            "pyq_focus": []
        }