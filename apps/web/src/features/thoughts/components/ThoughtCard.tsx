"use client";

interface ThoughtCardProps {
  thought: {
    _id: string;
    _creationTime: number;
    content: string;
    metadata: {
      type: string;
      topics: string[];
      people: string[];
      actionItems: string[];
      summary: string;
    };
  };
}

const typeColors: Record<string, string> = {
  decision: "#e3f2fd",
  person_note: "#f3e5f5",
  idea: "#fff3e0",
  meeting_note: "#e8f5e9",
  task: "#fce4ec",
  reference: "#f5f5f5",
};

export function ThoughtCard({ thought }: ThoughtCardProps) {
  const date = new Date(thought._creationTime).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div
      style={{
        border: "1px solid #e0e0e0",
        borderRadius: 8,
        padding: 16,
        backgroundColor: "#fff",
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 8,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            padding: "2px 8px",
            borderRadius: 4,
            fontSize: 12,
            backgroundColor:
              typeColors[thought.metadata.type] ?? typeColors.reference,
          }}
        >
          {thought.metadata.type.replace("_", " ")}
        </span>
        {thought.metadata.topics.map((topic) => (
          <span
            key={topic}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 12,
              backgroundColor: "#e8eaf6",
            }}
          >
            {topic}
          </span>
        ))}
        {thought.metadata.people.map((person) => (
          <span
            key={person}
            style={{
              padding: "2px 8px",
              borderRadius: 4,
              fontSize: 12,
              backgroundColor: "#fce4ec",
            }}
          >
            @{person}
          </span>
        ))}
        <span style={{ marginLeft: "auto", fontSize: 12, color: "#999" }}>
          {date}
        </span>
      </div>
      <p style={{ margin: 0, lineHeight: 1.5 }}>{thought.content}</p>
      {thought.metadata.actionItems.length > 0 && (
        <ul style={{ margin: "8px 0 0", paddingLeft: 20, color: "#666" }}>
          {thought.metadata.actionItems.map((item, i) => (
            <li key={i} style={{ fontSize: 14 }}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
