import pytest
from app import voice, decision_intent
from app.store import Store


@pytest.fixture
def bridge(tmp_path):
    store = Store(str(tmp_path / 'voice-decision.db'))
    state = store.dashboard('alice')
    events = []
    sent = []
    async def emit(event): events.append(event)
    session = voice.VoiceSession(state, store, emit)
    async def send(event): sent.append(event)
    session.send = send
    session.decision_context = {'concernId': 'concern-one', 'cardHash': 'a'*64, 'cardRevision': 1,
                                'expectedDecisionRevision': 0, 'contextGeneration': 1}
    return session, events, sent


async def test_voice_selection_pins_the_card_and_suppresses_duplicate_provider_execution(bridge, monkeypatch):
    session, events, sent = bridge
    received = []
    def decide(service, text, turn_id, context, user_id, **kw):
        received.append((context, user_id, kw))
        return {'status': 'queued', 'decision_id': 'decision-one', 'job_id': 'job-one'}
    monkeypatch.setattr(decision_intent, 'handle_user_decision', decide)
    await session.handle({'type': 'UserStartedSpeaking'})
    session.decision_context['concernId'] = 'concern-two'
    await session.handle({'type': 'ConversationText', 'role': 'user', 'content': 'Go with option two.'})
    assert received[0][0]['concernId'] == 'concern-one'
    assert received[0][1] == 'alice'
    assert any(e['type'] == 'concern.decision' and e['job_id'] == 'job-one' for e in events)
    await session.handle({'type': 'ConversationText', 'role': 'assistant', 'content': 'I will duplicate that work.'})
    assert not any(e.get('text') == 'I will duplicate that work.' for e in events)
    await session.handle({'type': 'FunctionCallRequest', 'functions': [{'id': 'tool-one', 'name': 'start_investigation', 'arguments': '{}'}]})
    assert sent[-1]['type'] == 'FunctionCallResponse'
    assert not session.tasks


async def test_typed_selection_acknowledges_without_injecting_synthetic_turn(bridge, monkeypatch):
    session, events, sent = bridge
    def decide(*args, **kwargs):
        assert kwargs['input_channel'] == 'text'
        return {'status': 'queued', 'decision_id': 'decision-one'}
    monkeypatch.setattr(decision_intent, 'handle_user_decision', decide)
    await session.inject('Choose option one.', 'turn-one')
    assert any(e['type'] == 'transcript' and e['id'] == 'turn-one' for e in events)
    assert not any(e.get('type') == 'InjectUserMessage' for e in sent)
    await session.inject('Choose option one.', 'turn-one')
    assert len([e for e in events if e['type'] == 'concern.decision']) == 1


async def test_question_remains_normal_conversation(bridge, monkeypatch):
    session, _, sent = bridge
    monkeypatch.setattr(decision_intent, 'handle_user_decision', lambda *a, **k: None)
    await session.inject('What would option two do?', 'question-one')
    assert sent[-1] == {'type': 'InjectUserMessage', 'content': 'What would option two do?'}
    assert not session.decision_turn
