---
title: "Logos: The Vision"
---

# Programming Languages are Abstractions

In the late 1950s, John McCarthy invented garbage collection for Lisp, because computers were powerful enough to manage memory for us.

Garbage-collected languages like Python or JavaScript *abstract memory management* away from the programmer. The result is that you can build better products with less effort, and end up with happier users.

Abstractions *hide complexity*. And when you hide one type of complexity, you can start doing more than you could before.

# What does Logos Abstract?

*Logos abstracts application logic*. Logos programmers think about *product behavior, and not about how to implement it*.

In Logos, you are the Product Manager and Architect; Logos is the Software Engineer.

As a Logos programmer, you define:
 1. *product behavior* (user stories, features)
 2. *architecture* (code design, scalability, maintainability)

and Logos implements the underlying code for you under the hood.

# Where is Logos Today?

You can run each of these examples.

*Logos abstracts complex expressions*. The following is valid code and does what you'd think:

```
print(`a list of prime numbers less than 100`)
print(`the alphabet on a gradual color gradient, starting from red, moving through to indigo`)
```

*Logos abstracts whole functions and classes*. The following is valid code and does what you'd think: 

```
def fib(n: int) -> int
def fizzbuzz(n: int) -> None

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

# What should I look at next?

Subscribe to updates for this project (new blogs, new releases; we won't spam you):

  [Type email...] [Subscribe]

Click [any of these links] if you want to contact us for any of the following reasons!
 - To collaborate on Logos, as a contributor or to do something serious in this area
 - To provide feedback
 - You think Logos could be useful in your business workflows

You can try Logos in our [Playground and Live Editor].

If you want to learn about the technical aspects of Logos, read [Logos: Technical Overview].

Logos is one part of a wider vision attempts to build better Developer tools in an AI world. See [TODO] for a high-level overview of where I think things are going.
