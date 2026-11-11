"use client";

const Badge = ({ count = 2 }) => <span title="Unread count">{count} new</span>;

const Arrow = () => (
  <section aria-label="Inbox">
    <Badge />
    <p>Written as an arrow with an expression body.</p>
  </section>
);

export default Arrow;
