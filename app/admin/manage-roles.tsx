import { useAuth } from "@/context/auth-context";
import { getBridgeToken } from "@/lib/token-bridge";
import {
  getUsers, toggleDriverRole,
  type DriverUser,
} from "@/services/skycable";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import {
  ChevronLeft, RefreshCw, Search, Truck, User,
} from "lucide-react-native";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator, Alert, FlatList, RefreshControl,
  StyleSheet, Switch, Text, TextInput, TouchableOpacity, View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G      = "#006241";
const G_LIGHT= "#ECFDF5";
const SLATE  = "#111827";
const MUTED  = "#667085";
const BORDER = "#E7ECF2";
const WHITE  = "#FFFFFF";
const BG     = "#F8FAFC";

function UserRoleCard({
  user, onToggle, toggling,
}: {
  user: DriverUser;
  onToggle: (u: DriverUser) => void;
  toggling: boolean;
}) {
  return (
    <View style={uc.card}>
      <View style={uc.avatar}>
        <User size={20} color={G} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={uc.name}>{user.name}</Text>
        <Text style={uc.email} numberOfLines={1}>{user.email}</Text>
        {user.is_driver && (
          <View style={uc.driverTag}>
            <Truck size={10} color={G} />
            <Text style={uc.driverTagTxt}>Driver</Text>
          </View>
        )}
      </View>
      {toggling
        ? <ActivityIndicator size="small" color={G} />
        : (
          <Switch
            value={user.is_driver}
            onValueChange={() => onToggle(user)}
            trackColor={{ false: "#E2E8F0", true: G + "80" }}
            thumbColor={user.is_driver ? G : "#CBD5E1"}
          />
        )}
    </View>
  );
}

export default function ManageRolesScreen() {
  const router        = useRouter();
  const { token, user } = useAuth();

  useEffect(() => {
    if (!user) return;
    const allowed = !!(user as any).is_admin || !!(user as any).is_executive || user.role === "admin";
    if (!allowed) router.replace("/" as any);
  }, [user]);

  const [users,      setUsers]      = useState<DriverUser[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [search,     setSearch]     = useState("");
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const load = useCallback(async () => {
    const authToken = getBridgeToken() ?? token ?? "";
    try {
      const data = await getUsers(authToken);
      setUsers(data);
    } catch {}
    finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function handleToggle(user: DriverUser) {
    const authToken = getBridgeToken() ?? token ?? "";
    setTogglingId(user.id);
    try {
      const updated = await toggleDriverRole(authToken, user.id);
      setUsers(prev => prev.map(u => u.id === updated.id ? { ...u, is_driver: updated.is_driver } : u));
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Could not update role.");
    } finally {
      setTogglingId(null);
    }
  }

  const filtered = users.filter(u =>
    !search || u.name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase())
  );

  const drivers  = filtered.filter(u => u.is_driver);
  const others   = filtered.filter(u => !u.is_driver);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView style={s.container}>

        {/* Header */}
        <View style={s.header}>
          <TouchableOpacity onPress={() => router.back()} style={s.backBtn}>
            <ChevronLeft size={22} color={SLATE} />
          </TouchableOpacity>
          <View style={{ flex: 1 }}>
            <Text style={s.title}>Manage Roles</Text>
            <Text style={s.subtitle}>Toggle driver / lineman access</Text>
          </View>
          <TouchableOpacity
            onPress={() => { setRefreshing(true); load(); }}
            style={s.iconBtn}
          >
            <RefreshCw size={16} color={G} style={refreshing ? { opacity: 0.4 } : undefined} />
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={s.searchWrap}>
          <Search size={16} color={MUTED} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Search users…"
            placeholderTextColor={MUTED}
          />
        </View>

        {loading ? (
          <View style={s.center}><ActivityIndicator size="large" color={G} /></View>
        ) : (
          <FlatList
            data={[
              ...(drivers.length > 0 ? [{ type: "header", label: `Drivers (${drivers.length})`, id: "h1" }] : []),
              ...drivers.map(u => ({ type: "user", ...u })),
              ...(others.length > 0 ? [{ type: "header", label: "Other Users", id: "h2" }] : []),
              ...others.map(u => ({ type: "user", ...u })),
            ] as any[]}
            keyExtractor={item => item.type === "header" ? item.id : String(item.id)}
            contentContainerStyle={s.list}
            showsVerticalScrollIndicator={false}
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => { setRefreshing(true); load(); }}
                colors={[G]} tintColor={G}
              />
            }
            renderItem={({ item }) => {
              if (item.type === "header") {
                return <Text style={s.sectionLabel}>{item.label}</Text>;
              }
              return (
                <UserRoleCard
                  user={item as DriverUser}
                  onToggle={handleToggle}
                  toggling={togglingId === item.id}
                />
              );
            }}
          />
        )}
      </SafeAreaView>
    </>
  );
}

const s = StyleSheet.create({
  container:   { flex: 1, backgroundColor: BG },
  center:      { flex: 1, alignItems: "center", justifyContent: "center" },
  header:      { flexDirection: "row", alignItems: "center", paddingHorizontal: 16, paddingVertical: 12, backgroundColor: WHITE, borderBottomWidth: 1, borderBottomColor: BORDER, gap: 8 },
  backBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center" },
  iconBtn:     { width: 40, height: 40, borderRadius: 20, alignItems: "center", justifyContent: "center", backgroundColor: G_LIGHT },
  title:       { fontSize: 20, fontWeight: "900", color: SLATE },
  subtitle:    { fontSize: 12, color: MUTED, fontWeight: "600" },
  searchWrap:  { flexDirection: "row", alignItems: "center", gap: 10, margin: 16, backgroundColor: WHITE, borderRadius: 14, borderWidth: 1, borderColor: BORDER, paddingHorizontal: 14, paddingVertical: 10 },
  searchInput: { flex: 1, fontSize: 14, color: SLATE },
  list:        { paddingHorizontal: 16, paddingBottom: 48, gap: 8 },
  sectionLabel:{ fontSize: 10, fontWeight: "900", color: MUTED, textTransform: "uppercase", letterSpacing: 1.5, marginTop: 8, marginBottom: 4 },
});

const uc = StyleSheet.create({
  card:       { flexDirection: "row", alignItems: "center", gap: 12, backgroundColor: WHITE, borderRadius: 16, padding: 14, borderWidth: 1, borderColor: BORDER },
  avatar:     { width: 42, height: 42, borderRadius: 21, backgroundColor: G_LIGHT, alignItems: "center", justifyContent: "center" },
  name:       { fontSize: 14, fontWeight: "800", color: SLATE },
  email:      { fontSize: 11, color: MUTED, fontWeight: "500", marginTop: 1 },
  driverTag:  { flexDirection: "row", alignItems: "center", gap: 4, backgroundColor: G_LIGHT, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2, marginTop: 4, alignSelf: "flex-start" },
  driverTagTxt:{ fontSize: 9, fontWeight: "900", color: G, textTransform: "uppercase" },
});
