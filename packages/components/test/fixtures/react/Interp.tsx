const user = { name: "Ada", unread: 3 };
const total = 12;

export default function Interp() {
  return (
    <>
      <p>
        Hello {user.name}, you have {user.unread} unread of {total}.
      </p>
      <p>{user.name}</p>
      <p>
        Sum: {total + 1} and {total * 2}
      </p>
    </>
  );
}
