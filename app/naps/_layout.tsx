import { Stack } from "expo-router";

export default function NapsLayout() {
  return <Stack screenOptions={{ headerShown: false, headerShadowVisible: false, headerStyle: { backgroundColor: "#FFFFFF" }, headerTintColor: "#0F172A" }} />;
}
