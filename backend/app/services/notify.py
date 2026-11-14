from sqlmodel import Session, select

from ..models import Notification, User


def notify(session: Session, user_id: int, title: str, body: str = "", link: str = "") -> None:
    session.add(Notification(user_id=user_id, title=title, body=body, link=link))


def notify_admins(session: Session, title: str, body: str = "", link: str = "") -> None:
    for admin in session.exec(select(User).where(User.role == "admin")).all():
        notify(session, admin.id, title, body, link)
