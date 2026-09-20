"""Conservative interpretation of a committed user turn against its pinned decision.

This parser never receives interim transcripts, source text, or assistant narration.
Only the authenticated voice-session owner may pass a final user turn here.
"""
import hashlib
import re
from .concerns import Conflict, DecisionChoice, DecisionCommand

NUMBERS = {'1': 'option_1', 'one': 'option_1', 'first': 'option_1',
           '2': 'option_2', 'two': 'option_2', 'second': 'option_2',
           '3': 'option_3', 'three': 'option_3', 'third': 'option_3'}
NUMBER = r'(?:one|two|three|first|second|third|1|2|3)'
CHOICE = rf'(?:option\s+({NUMBER})|(?:the\s+)?({NUMBER})\s+(?:option|choice))'
DIRECTIVE = re.compile(rf'^(?:okay[, ]*|ok[, ]*|yes[, ]*)?(?:please\s+)?(?:(?:go with|choose|select|pick|use|do|take)\s+(?:the\s+)?)?{CHOICE}(?:\s+(?:please|for me|now))?[.!]*$', re.I)
QUESTION = re.compile(r'^(?:what|why|how|when|where|which|would|could|can|should|tell me|explain|please explain)\b', re.I)
CUSTOM = re.compile(r'^(?:instead[, ]+|i want you to\s+|please\s+(?=(?:check|compare|review|investigate|prepare|look)\b))(.+)$', re.I | re.S)
NEGATIVE = re.compile(r"\b(?:not|don't|dont|do not|never|cancel|stop|neither)\b", re.I)


def handle_user_decision(service, text, turn_id, context, user_id, input_channel='voice'):
    """Return None, a clarification, or the same durable receipt as a button click."""
    text = text.strip()
    if not text or QUESTION.search(text) or text.endswith('?'):
        return None
    choice = DIRECTIVE.fullmatch(text)
    custom = CUSTOM.match(text)
    has_choice = re.search(CHOICE, text, re.I)
    if not choice and not custom:
        if has_choice and (NEGATIVE.search(text) or re.search(r'\b(?:and|or)\b', text, re.I)):
            return {'status': 'clarify', 'message': 'No choice was submitted. Choose one option or give a custom instruction.'}
        return None
    if NEGATIVE.search(text) and choice:
        return {'status': 'clarify', 'message': 'No choice was submitted. Tell me which action you want.'}
    if not context or not context.get('concernId'):
        return {'status': 'clarify', 'message': 'Which concern should I apply that choice to? Open its decision first.'}
    if not isinstance(turn_id, str) or not turn_id:
        return {'status': 'clarify', 'message': 'That turn could not be identified. Please try your choice again.'}
    option = next((NUMBERS[group.lower()] for group in choice.groups() if group), None) if choice else 'custom'
    try:
        command = DecisionCommand(
            commandId='turn_' + hashlib.sha256((user_id + ':' + turn_id).encode()).hexdigest()[:48],
            concernId=context['concernId'], expectedDecisionRevision=context['expectedDecisionRevision'],
            cardRevision=context['cardRevision'], cardHash=context['cardHash'], input=input_channel, userTurnId=turn_id,
            choice=DecisionChoice(optionId=option, instruction=custom.group(1).strip() if custom else None))
        return service.accept(command, user_id)
    except (Conflict, KeyError, ValueError, LookupError, PermissionError):
        return {'status': 'clarify', 'message': 'Those choices changed or are no longer available. Open the current decision before choosing.'}


def validate_context(context):
    """Only validated identity/version fields survive a browser context update."""
    if context is None:
        return None
    if not isinstance(context, dict):
        raise ValueError('Decision context must be an object')
    cid, card_hash = context.get('concernId'), context.get('cardHash')
    if not isinstance(cid, str) or not 1 <= len(cid) <= 160:
        raise ValueError('Invalid concern ID')
    if not isinstance(card_hash, str) or len(card_hash) > 64:
        raise ValueError('Invalid card hash')
    fields = ('cardRevision', 'expectedDecisionRevision', 'contextGeneration')
    if any(type(context.get(key)) is not int or context[key] < 0 for key in fields):
        raise ValueError('Invalid decision context revision')
    return {'concernId': cid, 'cardHash': card_hash, **{key: context[key] for key in fields}}
