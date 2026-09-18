import { ErrorScreen } from "@/components/error-screen";

// 404（協会が決まらない・資源がない・URL の協会と資源の協会が違う・§3.1）
export default function NotFound() {
  return (
    <ErrorScreen title="ページが見つかりません">
      <p>URL が間違っているか、ページがなくなっています。</p>
    </ErrorScreen>
  );
}
