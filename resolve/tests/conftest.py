import pytest

from mirror_resolve import store


@pytest.fixture()
def engine():
    return store.make_engine("sqlite:///:memory:")


@pytest.fixture()
def conn(engine):
    with engine.begin() as c:
        yield c
