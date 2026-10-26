import requests, json, sys

V = "5.199"  # при необходимости подними до актуальной
API = "https://api.vk.com/method/"

def call(method, token, **p):
    r = requests.post(API + method, data={**p, "access_token": token, "v": V}, timeout=20).json()
    if "error" in r:
        e = r["error"]
        return f"ERR {e['error_code']}: {e['error_msg']}"
    return "OK " + json.dumps(r["response"], ensure_ascii=False)[:90]

def run(label, token, gid, uid, post_id, write=False):
    print(f"\n=== {label} ===")
    owner = -gid
    tests = [
        ("account.getAppPermissions", dict(user_id=uid)),
        ("groups.getTokenPermissions", {}),
        ("groups.getById", dict(group_id=gid, fields="members_count")),
        ("groups.get", dict(user_id=uid, filter="admin", extended=1)),
        ("groups.getMembers", dict(group_id=gid, count=5, fields="last_seen,deactivated,is_closed")),
        ("groups.isMember", dict(group_id=gid, user_id=uid)),
        ("groups.getBanned", dict(group_id=gid, count=5)),
        ("groups.getRequests", dict(group_id=gid, count=5)),
        ("users.get", dict(user_ids=uid, fields="counters,last_seen")),
        ("friends.get", dict(user_id=uid, count=5)),
        ("users.getSubscriptions", dict(user_id=uid, count=5)),
        ("wall.get", dict(owner_id=owner, count=3)),
        ("likes.getList", dict(type="post", owner_id=owner, item_id=post_id, extended=1, count=5)),
        ("wall.getComments", dict(owner_id=owner, post_id=post_id, count=5)),
        ("stats.get", dict(group_id=gid, interval="day", intervals_count=3)),
        ("stats.getPostReach", dict(owner_id=owner, post_ids=post_id)),
    ]
    if write:  # ТОЛЬКО тестовое сообщество и тестовый аккаунт
        tests += [
            ("groups.ban", dict(group_id=gid, owner_id=TEST_USER, comment="api test")),
            ("groups.unban", dict(group_id=gid, owner_id=TEST_USER)),
            ("groups.removeUser", dict(group_id=gid, user_id=TEST_USER)),
        ]
    for m, p in tests:
        print(f"{m:30} {call(m, token, **p)}")

if __name__ == "__main__":
    USER_TOKEN, COMM_TOKEN = sys.argv[1], sys.argv[2]
    GID, MY_UID, POST_ID, TEST_USER = 123, 456, 789, 111  # подставь свои
    run("USER token (scope groups,stats)", USER_TOKEN, GID, MY_UID, POST_ID, write=False)
    run("COMMUNITY token (manage)", COMM_TOKEN, GID, MY_UID, POST_ID, write=False)