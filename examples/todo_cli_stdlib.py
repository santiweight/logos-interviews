from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date
import select
import sys
import termios
import tty


@dataclass
class Todo:
    id: str
    name: str
    description: str
    todo_date: date
    done: bool = False


@dataclass
class TodoList:
    todos: list[Todo] = field(default_factory=list)

    def add_todo(self, todo: Todo) -> None:
        self.todos.append(todo)

    def delete_todo(self, todo_id: str) -> None:
        self.todos = [todo for todo in self.todos if todo.id != todo_id]

    def set_date(self, todo_id: str, new_date: date) -> None:
        todo = self.find(todo_id)
        if todo:
            todo.todo_date = new_date

    def mark_done(self, todo_id: str) -> None:
        todo = self.find(todo_id)
        if todo:
            todo.done = not todo.done

    def find(self, todo_id: str) -> Todo | None:
        for todo in self.todos:
            if todo.id == todo_id:
                return todo
        return None


def todo_cli() -> None:
    app = TodoList([
        Todo("1", "Follow up with candidate", "Send notes from the interview.", date.today()),
        Todo("2", "Review prompt policy", "Tighten instructions for terminal apps.", date.today()),
        Todo("3", "Ship PTY run view", "Verify arrow keys in the browser terminal.", date.today()),
    ])
    selected = 0
    message = "n create | x delete | d done | e edit | arrows move | q quit"

    try:
        old_settings = termios.tcgetattr(sys.stdin)
        raw_mode_available = True
    except termios.error:
        old_settings = None
        raw_mode_available = False

    def enter_raw() -> None:
        if raw_mode_available:
            tty.setraw(sys.stdin.fileno())

    def leave_raw() -> None:
        if raw_mode_available and old_settings is not None:
            termios.tcsetattr(sys.stdin, termios.TCSADRAIN, old_settings)

    def clear() -> None:
        print("\033[2J\033[H", end="")

    def status_bar(text: str) -> str:
        return f"\033[30;47m {text:<76} \033[0m"

    def render() -> None:
        clear()
        print(status_bar("TODOS <GO>"))
        print("ID   STATUS  DATE        NAME")
        print("--   ------  ----------  --------------------------------")
        if not app.todos:
            print("     empty   ----        Press n to create a todo")
        for index, todo in enumerate(app.todos):
            pointer = ">" if index == selected else " "
            status = "DONE" if todo.done else "OPEN"
            style = "\033[7m" if index == selected else ""
            reset = "\033[0m" if index == selected else ""
            print(
                f"{style}{pointer} {todo.id:<3} {status:<6} "
                f"{todo.todo_date.isoformat():<10}  {todo.name[:32]:<32}{reset}"
            )
            if index == selected:
                print(f"      {todo.description}")
        print()
        print(status_bar(message))
        sys.stdout.flush()

    def read_key() -> str:
        if not raw_mode_available:
            command = input("command> ").strip().lower()
            aliases = {
                "up": "\x1b[A",
                "down": "\x1b[B",
                "new": "n",
                "delete": "x",
                "done": "d",
                "edit": "e",
                "quit": "q",
            }
            return aliases.get(command, command[:1])
        char = sys.stdin.read(1)
        if char == "\x1b" and select.select([sys.stdin], [], [], 0.02)[0]:
            rest = sys.stdin.read(2)
            return char + rest
        return char

    def prompt(label: str, default: str = "") -> str:
        leave_raw()
        try:
            suffix = f" [{default}]" if default else ""
            value = input(f"{label}{suffix}: ").strip()
            return value or default
        finally:
            enter_raw()

    def prompt_date(label: str, default: date) -> date:
        while True:
            raw = prompt(label, default.isoformat())
            try:
                return date.fromisoformat(raw)
            except ValueError:
                print("Use YYYY-MM-DD.")

    def current() -> Todo | None:
        if not app.todos:
            return None
        return app.todos[max(0, min(selected, len(app.todos) - 1))]

    def next_id() -> str:
        numeric_ids = [int(todo.id) for todo in app.todos if todo.id.isdigit()]
        return str((max(numeric_ids) if numeric_ids else 0) + 1)

    try:
        enter_raw()
        while True:
            if selected >= len(app.todos):
                selected = max(0, len(app.todos) - 1)
            render()
            key = read_key()

            if key in ("q", "\x03"):
                break
            if key == "\x1b[A" and app.todos:
                selected = max(0, selected - 1)
                message = "Moved up"
            elif key == "\x1b[B" and app.todos:
                selected = min(len(app.todos) - 1, selected + 1)
                message = "Moved down"
            elif key == "n":
                name = prompt("Name")
                description = prompt("Description")
                due = prompt_date("Date", date.today())
                app.add_todo(Todo(next_id(), name or "Untitled", description, due))
                selected = len(app.todos) - 1
                message = "Created todo"
            elif key == "x":
                todo = current()
                if todo:
                    app.delete_todo(todo.id)
                    message = f"Deleted {todo.id}"
                else:
                    message = "Nothing to delete"
            elif key == "d":
                todo = current()
                if todo:
                    app.mark_done(todo.id)
                    message = "Toggled done"
                else:
                    message = "Nothing to mark"
            elif key == "e":
                todo = current()
                if todo:
                    todo.name = prompt("Name", todo.name)
                    todo.description = prompt("Description", todo.description)
                    todo.todo_date = prompt_date("Date", todo.todo_date)
                    message = "Edited todo"
                else:
                    message = "Nothing to edit"
            else:
                message = "n create | x delete | d done | e edit | arrows move | q quit"
    finally:
        leave_raw()
        clear()
        print("Todo CLI closed.")
