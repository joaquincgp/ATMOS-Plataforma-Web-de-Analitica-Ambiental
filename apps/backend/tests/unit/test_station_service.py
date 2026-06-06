from types import SimpleNamespace

from app.services.station_service import list_stations


class _Scalars:
    def all(self):
        return [
            SimpleNamespace(id=1, code="A", name="Alpha", latitude=None, longitude=-78.5, is_active=True),
            SimpleNamespace(id=2, code="B", name="Beta", latitude=-0.2, longitude=None, is_active=False),
        ]


class _Db:
    def scalars(self, _statement):
        return _Scalars()


def test_list_stations_maps_null_coordinates_to_zero() -> None:
    response = list_stations(_Db())

    assert response.total == 2
    assert response.items[0].latitude == 0.0
    assert response.items[1].longitude == 0.0
