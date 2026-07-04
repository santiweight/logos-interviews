---
title: "Logos: the Vision"
---

# Programming Languages are Abstractions

In the 90s, we invented the Garbage Collector in languages like JS and Python, because computers were powerful enough to manage memory for us.

Garbage-collected languages let programmers stop managing memory, and let them manage their core application logic instead. *Garbage Collectors enabled us to build things we couldn't build before*. They abstracted memory-management.

# What does Logos Abstract?

*Logos abstracts of application logic*. Logos programmers think about *application behavior, and never about application logic*.

In Logos, you don't look at Python (unless you want to) just like you wouldn't look at machine code.

# Where is Logos Today?

*Logos abstracts complex  expressions*. The following is valid code and does what you'd think:

```
print(`a list of prime numbers less than 100`)
print(`the alphabet on a gradual color gradient, starting from red, moving through to indigo`)
```

*Logos abstracts whole functions and classes classes*. The following is valid code and does what you'd think: 

```
def fib(n: int) -> int
def fizzbuss(n: int) -> None

class Graph:
  nodes: set[str]
  edges: map[str, set[str]]

  def shortest_path(start: str, end: str) -> list[str]

  def reachable_nodes(start: str) -> set[str]
```

*Logos abstracts whole products*. The following is valid code, and builds a CLI UX for you:

````
class Todo:
  id: str
  name: str
  description: str
  todo_date: date
  
class TodoList:
  todos: list[Todo]
  
  def add_todo(todo)
  def delete_todo(todo_id)
  def set_date(todo_id, date)
  def mark_done(todo_id)

def todo_cli():
  ```
  make TodoList into an interactive CLI app

  use a simple bloomberg style application with:
   - x -> delete
   - n -> create
   - d -> mark done
   - e -> edit
  ```
````
