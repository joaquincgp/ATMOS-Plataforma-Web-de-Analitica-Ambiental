# Unit tests intentionally exercise internal dataframe transformation helpers.
# pylint: disable=protected-access

from types import SimpleNamespace

import pandas as pd

from app.schemas.etl import ManualDatasetOperation, ManualDatasetRoleMapping
from app.services.manual_dataset import ManualDatasetService
from app.services.manual_dataset.pipeline import ManualDatasetPipelineMixin


class ManualPipeline(ManualDatasetPipelineMixin):
    pass


def test_resolve_observed_at_series_from_datetime_and_date_time_columns() -> None:
    pipeline = ManualPipeline()
    dataframe = pd.DataFrame(
        {
            "fecha": ["01/01/2025", "02/01/2025"],
            "hora": ["03:00", "04:30"],
            "observed": ["2025-01-03T05:00:00", "2025-01-04T06:00:00"],
        }
    )

    direct = pipeline._resolve_observed_at_series(
        dataframe,
        ManualDatasetRoleMapping(datetime_column="observed"),
    )
    combined = pipeline._resolve_observed_at_series(
        dataframe,
        ManualDatasetRoleMapping(date_column="fecha", time_column="hora"),
    )

    assert direct.dt.hour.tolist() == [5, 6]
    assert combined.dt.hour.tolist() == [3, 4]


def test_apply_pipeline_selects_casts_samples_melts_and_adds_date_features() -> None:
    pipeline = ManualPipeline()
    dataframe = pd.DataFrame(
        {
            "fecha": ["2025-01-01 01:00:00", "2025-01-02 02:00:00", "2025-01-03 03:00:00", "2025-01-04 04:00:00"],
            "station": ["A", "A", "B", "B"],
            "pm25": ["10.5", "11.0", "12.5", "13.0"],
            "pm10": ["20", "21", "22", "23"],
        }
    )
    operations = [
        ManualDatasetOperation(type="select_columns", columns=["fecha", "station", "pm25", "pm10", "missing"]),
        ManualDatasetOperation(type="cast_types", numeric_columns=["pm25", "pm10"], categorical_columns=["station"]),
        ManualDatasetOperation(type="subsample", sample_pct=50),
        ManualDatasetOperation(type="melt", id_vars=["fecha", "station"], var_name="variable", value_name="value"),
        ManualDatasetOperation(type="date_features", date_column="fecha"),
        ManualDatasetOperation(type="cast_datetime", date_column="fecha", date_format="%Y-%m-%d %H:%M:%S"),
    ]

    result = pipeline._apply_pipeline(dataframe, operations, ManualDatasetRoleMapping(numeric_columns=["value"]))

    assert set(["fecha", "station", "variable", "value", "FechaYear", "FechaMonth", "FechaDay"]).issubset(
        result.columns
    )
    assert result["value"].dtype.kind in {"f", "i"}
    assert len(result) == 4


def test_apply_pipeline_cast_types_from_type_map() -> None:
    pipeline = ManualPipeline()
    dataframe = pd.DataFrame(
        {
            "name": [1, "sensor-b"],
            "integer_value": ["10", "10.5"],
            "float_value": ["1.25", "bad"],
            "double_value": ["2.5", "3.5"],
            "enabled": ["yes", "0"],
            "date_only": ["2025-01-01 10:30:00", "bad"],
            "timestamp": ["2025-01-01 10:30:00", "2025-01-02 11:45:00"],
        }
    )
    operations = [
        ManualDatasetOperation(
            type="cast_types",
            type_map={
                "name": "string",
                "integer_value": "int",
                "float_value": "float",
                "double_value": "double",
                "enabled": "boolean",
                "date_only": "date",
                "timestamp": "datetime",
            },
        )
    ]

    result = pipeline._apply_pipeline(dataframe, operations, ManualDatasetRoleMapping())

    assert str(result["name"].dtype) == "string"
    assert str(result["integer_value"].dtype) == "Int64"
    assert pd.isna(result.loc[1, "integer_value"])
    assert str(result["float_value"].dtype) == "Float32"
    assert pd.isna(result.loc[1, "float_value"])
    assert str(result["double_value"].dtype) == "Float64"
    assert str(result["enabled"].dtype) == "boolean"
    assert result["enabled"].tolist() == [True, False]
    assert str(result["date_only"].dtype).startswith("datetime64")
    assert result.loc[0, "date_only"].hour == 0
    assert str(result["timestamp"].dtype).startswith("datetime64")
    assert result.loc[0, "timestamp"].hour == 10


def test_summary_profile_preview_and_sync_dataset_state_are_consistent() -> None:
    pipeline = ManualPipeline()
    dataframe = pd.DataFrame(
        {
            "observed_at": pd.to_datetime(["2025-01-01", "2025-01-02"]),
            "value": [10.0, 11.5],
            "metadata": ["sensor-a", "sensor-b"],
        }
    )
    dataset = SimpleNamespace()
    mapping = ManualDatasetRoleMapping(datetime_column="observed_at", value_column="value")
    operations = [ManualDatasetOperation(type="cast_types", numeric_columns=["value"])]

    pipeline._sync_dataset_state(dataset, dataframe, operations, mapping)

    assert dataset.row_count == 2
    assert dataset.column_count == 3
    assert dataset.mapping_config["value_column"] == "value"
    assert dataset.profile_summary["datetime_columns"] == ["observed_at"]
    assert dataset.column_schema[2]["sample_values"] == ["sensor-a", "sensor-b"]
    assert dataset.preview_rows[0]["value"] == 10.0


def test_suggest_mapping_and_query_resolvers_use_roles_and_fallbacks() -> None:
    pipeline = ManualPipeline()
    dataframe = pd.DataFrame(
        {
            "Fecha": ["2025-01-01", "2025-01-02"],
            "Estacion": ["A", "B"],
            "Variable": ["PM25", "PM10"],
            "Valor": [10.0, 20.0],
            "Unit": ["ug/m3", "ug/m3"],
        }
    )

    mapping = pipeline._suggest_mapping(dataframe)

    assert mapping.date_column == "Fecha"
    assert mapping.station_code_column == "Estacion"
    assert mapping.variable_code_column == "Variable"
    assert mapping.value_column == "Valor"
    assert mapping.unit_column == "Unit"

    assert pipeline._resolve_query_observed_at_series(dataframe, mapping).notna().all()
    assert pipeline._resolve_query_value_column(dataframe, ManualDatasetRoleMapping()) == "Valor"
    assert pipeline._resolve_query_station_column(dataframe, mapping) == "Estacion"
    assert pipeline._resolve_query_variable_column(dataframe, ManualDatasetRoleMapping(), "Valor") == "Variable"
    assert pipeline._resolve_query_unit_column(dataframe, ManualDatasetRoleMapping()) == "Unit"


def test_pipeline_scalar_helpers_handle_empty_and_timezone_values() -> None:
    pipeline = ManualPipeline()

    assert pipeline._coerce_unit_value(None) is None
    assert pipeline._coerce_unit_value(" nan ") is None
    assert pipeline._coerce_unit_value(" ug/m3 ") == "ug/m3"
    assert pipeline._to_python_datetime(pd.Timestamp("2025-01-01")).year == 2025
    assert str(pipeline._to_utc_timestamp("2025-01-01T00:00:00-05:00")) == "2025-01-01 05:00:00+00:00"
    assert pipeline._stringify_sample({"key": "valor"}) == '{"key": "valor"}'
    assert pipeline._stringify_sample(["a", "b"]) == '["a", "b"]'


def test_missing_data_overview_reports_counts_and_percentages() -> None:
    service = ManualDatasetService(db=None)
    dataset = SimpleNamespace(id="dataset-1", name="demo")
    dataframe = pd.DataFrame({"value": [1.0, None, 3.0], "label": ["a", None, None]})

    overview = service._build_missing_data_overview(dataset=dataset, dataframe=dataframe)

    assert overview.total_missing_values == 3
    assert overview.columns[0].column == "value"
    assert overview.columns[0].missing_values == 1
    assert overview.columns[0].percentage_missing == 33.33
    assert overview.columns[1].missing_values == 2


def test_missing_data_imputation_uses_knn_for_numeric_and_mode_for_categorical() -> None:
    service = ManualDatasetService(db=None)
    dataframe = pd.DataFrame(
        {
            "nearest_feature": [1.0, 2.0, 100.0],
            "value": [10.0, None, 90.0],
            "category": ["north", None, "north"],
        }
    )

    numeric_result = service._knn_impute_numeric(dataframe[["nearest_feature", "value"]], n_neighbors=1)
    result = service._impute_missing_values_knn_mode(dataframe)

    assert result["value"].isna().sum() == 0
    assert numeric_result.loc[1, "value"] == 10.0
    assert result.loc[1, "category"] == "north"
