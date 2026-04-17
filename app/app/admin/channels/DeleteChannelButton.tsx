"use client"; // Это сделает компонент клиентским

import { deleteChannel } from "../actions";

export function DeleteChannelButton({ id }: { id: number }) {
  return (
    <button
      type="button"
      className="btn btn-sm"
      style={{ backgroundColor: '#442222', color: '#ff8888', border: '1px solid #663333' }}
      onClick={async () => {
        if (confirm("Удалить канал навсегда? Он исчезнет из всех салонов!")) {
          await deleteChannel(id);
        }
      }}
    >
      Delete
    </button>
  );
}