from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class WorkspaceCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=2000)


class WorkspaceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    owner_user_id: str
    name: str
    slug: str
    schema_name: str
    storage_path: str
    description: str | None
    is_active: bool
    created_at: datetime
    updated_at: datetime


class DashboardSaveRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    dashboard_id: str | None = Field(default=None, min_length=36, max_length=36)
    name: str = Field(min_length=3, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    blocks: list[dict[str, Any]] = Field(default_factory=list)
    filters: dict[str, Any] = Field(default_factory=dict)


class DashboardResponse(BaseModel):
    id: str
    name: str
    description: str | None
    blocks: list[dict[str, Any]]
    filters: dict[str, Any]
    created_by: str
    created_at: datetime
    updated_at: datetime
