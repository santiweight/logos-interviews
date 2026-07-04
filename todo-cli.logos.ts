type Todo = {
  description: string;
  dueDate: Date;
  done: boolean;
};

type TodoId = string;

class TodoList {
  todos: Map<TodoId, Todo>;

  add(todo: Todo): TodoId;
  delete(todoId: TodoId): void;
  update(todoId: TodoId, todo: Todo): void;
}


function todo_app(): ReactApp {
  l`
  Todo list application. Use Things 3 as inspiration.

  Seed with following data:
  
  [x] Buy groceries             [Today]
  [ ] Return clothes            [Tomorrow]
  [ ] Flight to Maldives        [Aug 27]
  [ ] Wedding                   [Dec 13 2027]

  Click the status to change status:
    - empty: empty circle
    - in progress: orange filled circle
    - done: green tick

  Click the date to raise a date picker that can select the date
  `
}
