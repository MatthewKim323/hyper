"""The learning log says what changed, and commits only when a reader would care."""
from app.learning_log import headline, render, worth_committing


def snap(mistakes=1, level=5, with_graded=30, with_ok=29, without_ok=18):
    arm = lambda ok, n: {'graded': n, 'correct': ok, 'wrong_releases': n - ok, 'timeouts': 0}
    return {'level': level, 'top_tier': 6, 'hard': {'with_memory': arm(with_ok, with_graded), 'without_memory': arm(without_ok, with_graded)},
            'routine': {'with_memory': arm(100, 100), 'without_memory': arm(100, 100)}, 'lessons': 140,
            'families': {'internal_hold': {'tier': 5, 'with_memory': 'XHHH', 'without_memory': 'XXHX'}},
            'mistakes': [{'at': 1789887000000 + i, 'invoice_id': f'INV-00{81 + i}', 'family': 'internal_hold', 'outcome': 'fail',
                          'finding': 'Every check passed but the desk had said not to pay.', 'lesson': 'An internal hold blocks payment.'} for i in range(mistakes)]}


def test_the_page_shows_the_score_the_run_and_each_mistake_with_its_lesson():
    page = render(snap(), 'lab', 'lab-control')
    assert '| with memory | 29/30 | 1 | 0 |' in page and '| without memory | 18/30 | 12 | 0 |' in page
    assert '`XHHH`' in page and 'INV-0081' in page and 'Audit finding: Every check passed' in page and 'Lesson the worker wrote: An internal hold' in page
    assert 'Development results' in page and 'simulated' in page, 'the caveats travel with the numbers'


def test_a_commit_needs_a_new_mistake_a_new_tier_or_a_real_batch_of_cases():
    base = snap()
    assert worth_committing(base, None)
    assert not worth_committing(snap(with_graded=34, with_ok=33), base), 'four more graded cases is noise'
    assert worth_committing(snap(mistakes=2), base) and worth_committing(snap(level=6), base)
    grown = snap(); grown['routine']['with_memory']['graded'] = 130
    assert worth_committing(grown, base)


def test_the_commit_message_states_the_result_and_what_is_new():
    message = headline(snap(mistakes=2, level=6), snap())
    assert message == 'learning log: tier 6, hard cases 29/30 with memory against 18/30 without, 1 new lesson from a mistake'
    assert 'new lesson' not in headline(snap(), snap())


def test_a_timeout_nobody_worked_is_the_machine_not_the_agent():
    from app.learning_log import arm, unworked
    asleep = {'outcome': 'timeout', 'family': 'duplicate_credit', 'state': {'requests': 0}}
    stuck = {'outcome': 'timeout', 'family': 'duplicate_credit', 'state': {'agent': {'sessions': 2}}}
    assert unworked(asleep) and not unworked(stuck)
    assert arm([asleep, stuck, {'outcome': 'pass', 'family': 'clean', 'state': {}}]) == {'graded': 2, 'correct': 1, 'wrong_releases': 0, 'timeouts': 1}
