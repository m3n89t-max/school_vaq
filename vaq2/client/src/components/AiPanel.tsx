import { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  // 필요하면 나중에 props 확장
};

function nowHHMM() {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

export default function AiPanel(_props: Props) {
  // 알림(큰 글씨로 보여줄 1~2줄)
  const [alertText, setAlertText] = useState<string>("데이터 수신 중…");
  const [statusLine, setStatusLine] = useState<string>("연결 준비");
  const [lastUpdated, setLastUpdated] = useState<string>(nowHHMM());

  const wsUrl = useMemo(() => {
    // 같은 PC에서 UI 실행 시 기본: ws://localhost:8000/ws_alert
    // 혹시 UI가 다른 PC에서 뜨면, 브릿지 PC IP로 바꾸면 됨.
    return "ws://localhost:8000/ws_alert";
  }, []);

  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef<number | null>(null);
  const retryCountRef = useRef<number>(0);

  const connect = () => {
    try {
      setStatusLine("연결 중…");
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        retryCountRef.current = 0;
        setStatusLine("연결됨");
      };

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          const text: string | undefined =
            typeof msg?.alert === "string" ? msg.alert : undefined;

          if (text && text.trim().length > 0) {
            setAlertText(text.trim());
            setLastUpdated(nowHHMM());
            setStatusLine("연결됨");
          }
        } catch {
          // JSON이 아니면 무시
        }
      };

      ws.onerror = () => {
        setStatusLine("연결 오류");
      };

      ws.onclose = () => {
        setStatusLine("재연결 중…");
        scheduleReconnect();
      };
    } catch {
      setStatusLine("연결 실패");
      scheduleReconnect();
    }
  };

  const scheduleReconnect = () => {
    if (retryRef.current) return;
    // 점진적 재시도 (최대 10초)
    retryCountRef.current += 1;
    const delay = Math.min(10000, 1000 + retryCountRef.current * 1000);

    retryRef.current = window.setTimeout(() => {
      retryRef.current = null;
      // 기존 소켓 정리
      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
      connect();
    }, delay);
  };

  useEffect(() => {
    connect();
    return () => {
      if (retryRef.current) window.clearTimeout(retryRef.current);
      retryRef.current = null;

      try {
        wsRef.current?.close();
      } catch {}
      wsRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsUrl]);

  // 1~2줄만 표시 (혹시 더 길게 오면 잘라줌)
  const lines = useMemo(() => {
    const raw = (alertText || "").split("\n").map((v) => v.trim()).filter(Boolean);
    if (raw.length === 0) return ["데이터 수신 중…"];
    return raw.slice(0, 2);
  }, [alertText]);

  return (
    <div style={styles.wrap}>
      <div style={styles.headerRow}>
        <div style={styles.titleRow}>
          <span style={styles.icon}>🧠</span>
          <span style={styles.title}>AI 공기질 실시간 분석</span>
        </div>

        <div style={styles.metaRow}>
          <span style={styles.statusDot(statusLine === "연결됨")} />
          <span style={styles.metaText}>
            {statusLine} · {lastUpdated}
          </span>
        </div>
      </div>

      <div style={styles.body}>
        {/* 큰 글씨 핵심 알림 */}
        <div style={styles.bigText}>
          <div>{lines[0]}</div>
          {lines[1] ? <div style={styles.bigText2}>{lines[1]}</div> : null}
        </div>

        {/* 작게 한 줄 가이드(선택) */}
        <div style={styles.hint}>
          ※ 예: “주의 · CO2 1200” / “급기+10% 배기+10%”
        </div>
      </div>
    </div>
  );
}

const styles: any = {
  wrap: {
    height: "100%",
    display: "flex",
    flexDirection: "column",
    background: "rgba(0,0,0,0.35)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 14,
    padding: 14,
    overflow: "hidden",
  },
  headerRow: {
    display: "flex",
    justifyContent: "space-between",
    alignItems: "flex-start",
    gap: 12,
    paddingBottom: 10,
    borderBottom: "1px solid rgba(255,255,255,0.08)",
  },
  titleRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  icon: {
    fontSize: 20,
    lineHeight: "20px",
  },
  title: {
    fontSize: 18,
    fontWeight: 800,
    color: "#EDEDED",
  },
  metaRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginTop: 2,
  },
  statusDot: (ok: boolean) => ({
    width: 10,
    height: 10,
    borderRadius: 999,
    background: ok ? "#2EE59D" : "#FF5C5C",
    boxShadow: ok
      ? "0 0 12px rgba(46,229,157,0.6)"
      : "0 0 12px rgba(255,92,92,0.5)",
    flex: "0 0 auto",
  }),
  metaText: {
    fontSize: 12,
    color: "rgba(255,255,255,0.75)",
    fontWeight: 700,
    whiteSpace: "nowrap",
  },
  body: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    paddingTop: 14,
    gap: 10,
  },

  // ✅ 멀리서 읽히는 큰 글씨
  bigText: {
    fontSize: 36,
    fontWeight: 900,
    lineHeight: 1.3,
    letterSpacing: "-0.6px",
    color: "#F5F5F5",
    textShadow: "0 2px 12px rgba(0,0,0,0.6)",
    padding: "10px 10px",
    borderRadius: 12,
    background: "rgba(255,255,255,0.04)",
    border: "1px solid rgba(255,255,255,0.06)",
    wordWrap: "break-word",
    overflowWrap: "break-word",
    wordBreak: "keep-all",
  },
  bigText2: {
    marginTop: 10,
    fontSize: 32,
    fontWeight: 900,
    opacity: 0.98,
    lineHeight: 1.3,
    wordWrap: "break-word",
    overflowWrap: "break-word",
    wordBreak: "keep-all",
  },

  hint: {
    fontSize: 12,
    color: "rgba(255,255,255,0.55)",
    fontWeight: 700,
    paddingLeft: 6,
  },
};
