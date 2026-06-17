from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

ConfigValue = int | float
ConfigGroup = Literal["analytics", "workspace"]


class AppConfigItem(BaseModel):
    key: str
    value: ConfigValue
    default_value: ConfigValue
    description: str
    group: ConfigGroup


class AppConfigResponse(BaseModel):
    items: list[AppConfigItem]


class AppConfigUpdateItem(BaseModel):
    key: str
    value: ConfigValue


class AppConfigUpdateRequest(BaseModel):
    items: list[AppConfigUpdateItem] = Field(min_length=1)
