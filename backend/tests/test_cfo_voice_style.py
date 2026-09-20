import pytest
from app import voice


@pytest.fixture
def state(monkeypatch):
    for name in ('DEEPGRAM_THINK_MODEL', 'DEEPGRAM_THINK_PROVIDER', 'CFO_THINK_MODEL', 'CFO_THINK_PROVIDER', 'CFO_REASONING_MODE'):
        monkeypatch.delenv(name, raising=False)
    return {'mode': 'dashboard', 'context': {}, 'readiness': {}, 'transcript': [], 'history': []}


def test_cfo_uses_reasoning_without_changing_onboarding(state):
    cfg = voice.settings(state)
    assert cfg['agent']['think']['provider'] == {'type': 'open_ai', 'model': 'gpt-5', 'reasoning_mode': 'medium'}
    assert voice.CFO_SPEECH_PROMPT in cfg['agent']['think']['prompt']
    assert cfg['agent']['think']['functions'], 'Reasoning must retain the real tool loop.'
    assert 'endpoint' not in cfg['agent']['think'], 'Managed voice must not leak a separate provider credential.'
    state['mode'] = 'onboarding'
    cfg = voice.settings(state)
    assert cfg['agent']['think']['provider'] == {'type': 'open_ai', 'model': 'gpt-4o-mini'}
    assert voice.CFO_SPEECH_PROMPT not in cfg['agent']['think']['prompt']


def test_explicit_nonreasoning_provider_does_not_receive_openai_only_setting(state, monkeypatch):
    monkeypatch.setenv('DEEPGRAM_THINK_PROVIDER', 'anthropic')
    monkeypatch.setenv('DEEPGRAM_THINK_MODEL', 'claude-haiku-4-5')
    assert voice.settings(state)['agent']['think']['provider'] == {'type': 'anthropic', 'model': 'claude-haiku-4-5'}
    monkeypatch.setenv('CFO_THINK_PROVIDER', 'open_ai')
    monkeypatch.setenv('CFO_THINK_MODEL', 'gpt-5')
    monkeypatch.setenv('CFO_REASONING_MODE', 'low')
    assert voice.settings(state)['agent']['think']['provider']['reasoning_mode'] == 'low'


def test_invalid_effort_fails_before_opening_a_provider_session(state, monkeypatch):
    monkeypatch.setenv('CFO_REASONING_MODE', 'typo')
    with pytest.raises(ValueError, match='CFO_REASONING_MODE'):
        voice.settings(state)
