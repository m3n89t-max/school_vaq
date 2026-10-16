import MetricCard from "./MetricCard";

type Room = "kitchen" | "washing";

type RoomData = {
  pm10: number;
  pm25: number;
  co2: number;
  voc: number;
  hcho: number;
  co: number;
  temp: number;
  hum: number;
};

type Props = {
  title: string;
  room: Room;
  data: RoomData;
};

export default function RoomPanel({ title, room, data }: Props) {
  return (
    <section style={{ flex: 1 }}>
      <h2 style={{ fontSize: 28, margin: "8px 0 16px" }}>{title}</h2>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gap: 16,
        }}
      >
        <MetricCard metric="pm10" value={data.pm10} room={room} />
        <MetricCard metric="pm25" value={data.pm25} room={room} />
        <MetricCard metric="co2" value={data.co2} room={room} />
        <MetricCard metric="voc" value={data.voc} room={room} />
        <MetricCard metric="hcho" value={data.hcho} room={room} />
        <MetricCard metric="co" value={data.co} room={room} />
        <MetricCard metric="temp" value={data.temp} room={room} />
        <MetricCard metric="hum" value={data.hum} room={room} />
      </div>
    </section>
  );
}
