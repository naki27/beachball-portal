import { ErrorScreen } from "@/components/error-screen";

// 協会の画面の中での 404（資源がない・URL の協会と資源の協会が違う・§3.1）
export default function AssociationNotFound() {
  return (
    <ErrorScreen title="ページが見つかりません">
      <p>URL が間違っているか、ページがなくなっています。</p>
    </ErrorScreen>
  );
}
