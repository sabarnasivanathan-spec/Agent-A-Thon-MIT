from agents.tutor_agent import TutorAgent
from agents.notes_agent import NotesAgent
from agents.quiz_agent import QuizAgent
from agents.material_agent import MaterialAgent
from agents.planner_agent import PlannerAgent


class StudyAgentOrchestrator:

    def __init__(self):

        self.material_agent = MaterialAgent()

        self.tutor_agent = TutorAgent()

        self.notes_agent = NotesAgent()

        self.quiz_agent = QuizAgent()

        self.planner_agent = PlannerAgent()


    async def ask(
        self,
        question,
        context,
        topic=None
    ):

        return await self.tutor_agent.run(
            question,
            context,
            topic
        )


    async def generate_notes(
        self,
        topic,
        context,
        pyqs
    ):

        return await self.notes_agent.run(
            topic,
            context,
            pyqs
        )


    async def generate_quiz(
        self,
        topic,
        context,
        count,
        difficulty
    ):

        return await self.quiz_agent.run(
            topic,
            context,
            count,
            difficulty
        )


    async def generate_flashcards(
        self,
        topic,
        context,
        count
    ):

        return await self.quiz_agent.flashcards(
            topic,
            context,
            count
        )