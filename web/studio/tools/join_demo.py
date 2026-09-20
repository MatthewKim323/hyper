"""Put signed-in users into the imported Meridian demo workspace.

The backend gives every new login an empty workspace of its own unless the Clerk user id was
listed in DEMO_USER_IDS before that first login, which you cannot know in advance. A user's
workspace is their first membership by organization id, and "demo-meridian" sorts before the
generated "org_..." ids, so adding that membership is enough. Nothing is deleted.

    uv run --directory backend python ../web/studio/tools/join_demo.py            # everyone who has signed in
    uv run --directory backend python ../web/studio/tools/join_demo.py user_abc   # one user
"""
import sys
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[3] / "backend"
sys.path.insert(0, str(BACKEND))

from dotenv import load_dotenv  # noqa: E402

load_dotenv(BACKEND / ".env")

from sqlalchemy import select  # noqa: E402

from app.database import memberships, organizations, users  # noqa: E402
from app.store import Store  # noqa: E402

store = Store()
with store.connect() as db:
    if not db.execute(select(organizations.c.id).where(organizations.c.id == "demo-meridian")).scalar():
        sys.exit("demo-meridian does not exist yet. Run: uv run python -m app.data_cli --env-file .env import-demo")
    wanted = sys.argv[1:] or [row[0] for row in db.execute(select(users.c.id))]
    already = {row[0] for row in db.execute(select(memberships.c.user_id).where(memberships.c.organization_id == "demo-meridian"))}
if not wanted:
    sys.exit("Nobody has signed in yet. Sign in once on the site, then run this again.")
for user_id in wanted:
    if user_id in already:
        print(f"{user_id}: already in demo-meridian")
    else:
        store.add_member(user_id, "demo-meridian")
        print(f"{user_id}: added to demo-meridian")
