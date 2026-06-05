import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { View } from "react-native";
import TabTransitionOverlay from "@/components/TabTransitionOverlay";

export default function LoadingScreen() {
  const { next } = useLocalSearchParams<{ next?: string }>();
  const [visible, setVisible] = useState(true);

  const handleDone = () => {
    setVisible(false);
    router.replace((next as any) || "/(tabs)");
  };

  return (
    <View style={{ flex: 1, backgroundColor: "#ffffff" }}>
      <TabTransitionOverlay visible={visible} onDone={handleDone} />
    </View>
  );
}
