import { useEffect, useMemo, useRef, useState } from "react";
import { Box, Button, Chip, Paper, Select, MenuItem, Stack, Switch, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { api, wsUrl } from "../lib/api";
import { useAppStore } from "../state/store";

type TtlItem = {
  device: string;
  level: "HIGH" | "LOW";
  override: boolean;
  value: boolean;
};

export default function TTLControlsView() {
  const showToast = useAppStore((s) => s.showToast);
  const [devices, setDevices] = useState<string[]>([]);
  const [items, setItems] = useState<Record<string, TtlItem>>({});
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const resp = await api.getTtlDevices();
        if (!mounted) return;
        setDevices(resp.devices ?? []);
        const next: Record<string, TtlItem> = {};
        for (const dev of resp.devices ?? []) {
          next[dev] = { device: dev, level: "LOW", override: false, value: false };
        }
        setItems(next);
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        showToast("TTL devices failed", msg);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [showToast]);

  useEffect(() => {
    let closing = false;

    const connect = () => {
      const ws = new WebSocket(wsUrl("/ttl/status/"));
      wsRef.current = ws;

      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data);
          if (data?.type !== "ttl_status") return;
          const next: Record<string, TtlItem> = {};
          for (const it of data.items ?? []) {
            next[it.device] = it;
          }
          setItems(next);
        } catch {
          // ignore
        }
      };

      ws.onerror = () => {
        if (!closing) showToast("TTL stream error", "WebSocket error. Retrying...");
      };

      ws.onclose = () => {
        wsRef.current = null;
        if (closing) return;
        if (reconnectTimerRef.current != null) window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = window.setTimeout(connect, 1000);
      };
    };

    connect();
    return () => {
      closing = true;
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {
        // ignore
      }
      wsRef.current = null;
    };
  }, [showToast]);

  const rows = useMemo(() => devices.map((d) => items[d] ?? { device: d, level: "LOW", override: false, value: false }), [devices, items]);

  async function updateLevel(device: string, level: "HIGH" | "LOW") {
    try {
      await api.setTtlLevel([device], [level]);
      setItems((prev) => ({ ...prev, [device]: { ...(prev[device] ?? { device, override: false, value: false }), level } }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("TTL update failed", msg);
    }
  }

  async function updateOverride(device: string, override: boolean) {
    try {
      await api.setTtlOverride([device], [override]);
      setItems((prev) => ({ ...prev, [device]: { ...(prev[device] ?? { device, level: "LOW", value: false }), override } }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      showToast("TTL update failed", msg);
    }
  }

  return (
    <Paper variant="outlined" sx={{ p: 1.25 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Box>
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>TTL Controls</Typography>
          <Typography variant="caption" color="text.secondary">Mock hardware endpoints</Typography>
        </Box>
        <Button size="small" variant="outlined" onClick={() => window.location.reload()}>
          Refresh
        </Button>
      </Stack>

      <Table
        size="small"
        sx={{
          mt: 0.75,
          "& .MuiTableCell-root": {
            py: 0.4,
          },
        }}
      >
        <TableHead>
          <TableRow>
            <TableCell>Device</TableCell>
            <TableCell>Override</TableCell>
            <TableCell>Level</TableCell>
            <TableCell>Status</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.device} hover>
              <TableCell sx={{ fontFamily: "var(--mono)", py: 0.4 }}>{row.device}</TableCell>
              <TableCell>
                <Switch
                  size="small"
                  checked={row.override}
                  onChange={(e) => updateOverride(row.device, e.target.checked)}
                  sx={{ my: -0.25 }}
                />
              </TableCell>
              <TableCell>
                <Select
                  size="small"
                  value={row.level}
                  onChange={(e) => updateLevel(row.device, e.target.value as "HIGH" | "LOW")}
                  sx={{
                    minHeight: 28,
                    "& .MuiSelect-select": {
                      py: "3px",
                    },
                  }}
                >
                  <MenuItem value="HIGH">HIGH</MenuItem>
                  <MenuItem value="LOW">LOW</MenuItem>
                </Select>
              </TableCell>
              <TableCell>
                <Chip
                  size="small"
                  label={row.value ? "HIGH" : "LOW"}
                  color={row.value ? "success" : "default"}
                  variant="outlined"
                  sx={{
                    height: 22,
                    "& .MuiChip-label": {
                      px: 1,
                    },
                    ...(row.value
                      ? {}
                      : {
                          color: "var(--text)",
                          borderColor: "var(--border)",
                          backgroundColor: "color-mix(in srgb, var(--panel2) 88%, transparent)",
                        }),
                  }}
                />
              </TableCell>
            </TableRow>
          ))}
          {rows.length === 0 && (
            <TableRow>
              <TableCell colSpan={4} sx={{ color: "text.secondary" }}>
                No TTL devices detected.
              </TableCell>
            </TableRow>
          )}
        </TableBody>
      </Table>
    </Paper>
  );
}
