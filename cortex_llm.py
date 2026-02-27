"""
Custom LLM wrapper for Snowflake Cortex to use with CrewAI.
"""
import os
from typing import Any, Optional
import snowflake.connector
from litellm import CustomLLM
from litellm.types.utils import ModelResponse, Choices, Message


class SnowflakeCortexLLM(CustomLLM):
    """
    Custom LLM that uses Snowflake Cortex AI_COMPLETE function.
    """
    
    def __init__(self, connection: Optional[snowflake.connector.SnowflakeConnection] = None, model: str = "llama3.1-70b"):
        self.conn = connection
        self.model = model
        self._connect()
    
    def _connect(self):
        """Establish Snowflake connection if not provided."""
        if self.conn is None:
            self.conn = snowflake.connector.connect(
                account=os.environ["SNOWFLAKE_ACCOUNT"],
                user=os.environ["SNOWFLAKE_USER"],
                password=os.environ["SNOWFLAKE_PASSWORD"],
                database=os.environ.get("SNOWFLAKE_DATABASE", "RECONCILIATION"),
                schema=os.environ.get("SNOWFLAKE_SCHEMA", "PUBLIC"),
                warehouse=os.environ.get("SNOWFLAKE_WAREHOUSE", "COMPUTE_WH"),
            )
    
    def completion(self, model: str, messages: list, **kwargs) -> ModelResponse:
        """
        Call Snowflake Cortex AI_COMPLETE with the given messages.
        """
        # Format messages into a single prompt
        prompt = self._format_messages(messages)
        
        # Call Cortex AI_COMPLETE
        cursor = self.conn.cursor()
        try:
            # Escape single quotes in prompt
            escaped_prompt = prompt.replace("'", "''")
            
            sql = f"""
                SELECT SNOWFLAKE.CORTEX.COMPLETE(
                    '{self.model}',
                    '{escaped_prompt}'
                ) AS response
            """
            cursor.execute(sql)
            result = cursor.fetchone()
            response_text = result[0] if result else ""
            
            # Return in litellm format
            return ModelResponse(
                id="cortex-response",
                choices=[
                    Choices(
                        finish_reason="stop",
                        index=0,
                        message=Message(
                            content=response_text,
                            role="assistant"
                        )
                    )
                ],
                model=self.model,
            )
        finally:
            cursor.close()
    
    def _format_messages(self, messages: list) -> str:
        """Format chat messages into a single prompt string."""
        formatted = []
        for msg in messages:
            role = msg.get("role", "user")
            content = msg.get("content", "")
            if role == "system":
                formatted.append(f"System: {content}")
            elif role == "user":
                formatted.append(f"User: {content}")
            elif role == "assistant":
                formatted.append(f"Assistant: {content}")
        
        formatted.append("Assistant:")
        return "\n\n".join(formatted)


def get_cortex_llm(model: str = "llama3.1-70b") -> str:
    """
    Get the LLM string for CrewAI to use Snowflake Cortex via litellm.
    
    CrewAI uses litellm which supports custom providers.
    We'll use the snowflake_cortex provider.
    """
    return f"snowflake_cortex/{model}"
