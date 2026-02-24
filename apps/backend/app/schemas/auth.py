from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    email: str = Field(min_length=5)
    password: str = Field(min_length=8)


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    expires_in: int
