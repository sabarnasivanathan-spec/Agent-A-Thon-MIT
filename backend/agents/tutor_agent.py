from ai_service import (
    SYSTEM_PROMPT,
    call_llm,
    extract_json
)


class TutorAgent:

    name = "tutor_agent"


    async def run(
        self,
        question,
        context,
        topic=None
    ):

        source_text = "\n\n".join(

            f"[Source {index + 1}] {chunk['text']}"

            for index, chunk
            in enumerate(context)
        )


        prompt = f"""
Answer the student's question.

Topic:
{topic or "Not specified"}

Question:
{question}


Study material:

{source_text or "[No matching material found]"}


Return JSON in this format:

{{
    "answer": "clear answer",
    "topic": "matching topic",
    "sources": ["source labels"]
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


        if not result:

            return {

                "answer": raw,

                "topic": topic,

                "sources": []
            }


        return result