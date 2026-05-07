import { useAuth } from "@/context/auth-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Location from "expo-location";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  Image,
  ImageBackground,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { LinearGradient } from "expo-linear-gradient";
import { useRouter } from "expo-router";
import { saveDisplayTime } from "@/lib/display-time";
import {
  Calendar,
  Clock,
  Box,
  Map,
  MapPin,
  Wind,
  Droplets,
  LogOut,
} from "lucide-react-native";

const { width } = Dimensions.get("window");

const PAGE_PADDING = 24;
const CARD_WIDTH = width - PAGE_PADDING * 2;
const CARD_GAP = 16;

const WEATHER_BACKGROUNDS = {
  sunny: require("@/assets/images/weather-image/sunny.jpg"),
  cloudy: require("@/assets/images/weather-image/cloudy.jpg"),
  partlyCloudy: require("@/assets/images/weather-image/partly_cloudy.jpg"),
  rainy: require("@/assets/images/weather-image/rainy.jpg"),
  thunderstorm: require("@/assets/images/weather-image/thunderstorm.jpg"),
  foggy: require("@/assets/images/weather-image/foggy.jpg"),
  night: require("@/assets/images/weather-image/night.jpg"),
  rainyNight: require("@/assets/images/weather-image/rainy-night.jpg"),
  sunnySunset: require("@/assets/images/weather-image/sunny-sunset.jpg"),
};

const WEATHER_ICONS = {
  sunny: require("@/assets/images/weather-icons/sunny.png"),
  cloudy: require("@/assets/images/weather-icons/cloudy.png"),
  cloudySunny: require("@/assets/images/weather-icons/cloudy-sunny.png"),
  thunder: require("@/assets/images/weather-icons/cloudy-thunder.png"),
  rain: require("@/assets/images/weather-icons/rainy.png"),
  rainyThunder: require("@/assets/images/weather-icons/rainy-thunder.png"),
  night: require("@/assets/images/weather-icons/night.png"),
  cloudyNight: require("@/assets/images/weather-icons/cloudy-night.png"),
  temperature: require("@/assets/images/weather-icons/temperature.png"),
  wind: require("@/assets/images/weather-icons/windy-night.png"),
};

type WeatherVisualType =
  | "sunny"
  | "cloudy"
  | "partlyCloudy"
  | "rainy"
  | "thunderstorm"
  | "foggy"
  | "night";

type WeatherState = {
  temperature: number | null;
  feelsLike: number | null;
  humidity: number | null;
  windSpeed: number | null;
  weatherCode: number | null;
  locationName: string;
  status: "loading" | "ready" | "error";
};



// ── Home screen ───────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const { logout, user } = useAuth();
  const router = useRouter();
  const firstName = user?.first_name ?? "User";

  const horizontalScrollRef = useRef<ScrollView>(null);

  const [now, setNow] = useState(new Date());
  const [activeSlide, setActiveSlide] = useState(0);


  const [weather, setWeather] = useState<WeatherState>({
    temperature: null,
    feelsLike: null,
    humidity: null,
    windSpeed: null,
    weatherCode: null,
    locationName: "Getting location...",
    status: "loading",
  });

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Save PHT snapshot on mount and every time app comes to foreground
  useEffect(() => {
    saveDisplayTime();
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") saveDisplayTime();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const WEATHER_KEY = "cached_weather";

    const loadWeather = async () => {
      // Load cached weather first so screen is never blank
      try {
        const raw = await AsyncStorage.getItem(WEATHER_KEY);
        if (raw) {
          const cached: WeatherState = JSON.parse(raw);
          setWeather({ ...cached, status: "ready" });
        }
      } catch {}

      // Fetch fresh weather
      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== "granted") return;

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const { latitude, longitude } = currentLocation.coords;

        const reverseGeo = await Location.reverseGeocodeAsync({ latitude, longitude });
        const place = reverseGeo[0];
        const locationName =
          place?.city || place?.subregion || place?.region || "Current Location";

        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`
        );

        const data = await response.json();

        const fresh: WeatherState = {
          temperature: data?.current?.temperature_2m ?? null,
          feelsLike: data?.current?.apparent_temperature ?? null,
          humidity: data?.current?.relative_humidity_2m ?? null,
          windSpeed: data?.current?.wind_speed_10m ?? null,
          weatherCode: data?.current?.weather_code ?? null,
          locationName,
          status: "ready",
        };

        setWeather(fresh);
        await AsyncStorage.setItem(WEATHER_KEY, JSON.stringify(fresh));
      } catch {
        // Keep whatever is already shown (cached or loading state)
      }
    };

    loadWeather();
  }, []);

  // Always derive PHT (UTC+8) from the UTC epoch — immune to device timezone changes
  const pht = useMemo(() => new Date(now.getTime() + 8 * 3600 * 1000), [now]);

  const greeting = useMemo(() => {
    const hour = pht.getUTCHours();
    if (hour < 12) return "Good Morning";
    if (hour < 18) return "Good Afternoon";
    return "Good Evening";
  }, [pht]);

  const timeText = useMemo(() => {
    let hours = pht.getUTCHours();
    const minutes = pht.getUTCMinutes().toString().padStart(2, "0");
    const seconds = pht.getUTCSeconds().toString().padStart(2, "0");
    const ampm = hours >= 12 ? "PM" : "AM";
    hours = hours % 12;
    hours = hours ? hours : 12;
    return { hm: `${hours}:${minutes}`, seconds, ampm };
  }, [pht]);

  const dateInfo = useMemo(() => {
    const dayNames = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const monthNames = ["January", "February", "March", "April", "May", "June",
      "July", "August", "September", "October", "November", "December"];
    return {
      dayName: dayNames[pht.getUTCDay()],
      dayNum: pht.getUTCDate(),
      month: monthNames[pht.getUTCMonth()],
      year: pht.getUTCFullYear(),
    };
  }, [pht]);

  const visualType = getWeatherVisualType(weather.weatherCode, pht);
  const weatherTitle = getWeatherTitle(weather.weatherCode);

  const handleSlideEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const x = event.nativeEvent.contentOffset.x;
    const index = Math.round(x / (CARD_WIDTH + CARD_GAP));
    setActiveSlide(index);
  };

  const goToSlide = (index: number) => {
    horizontalScrollRef.current?.scrollTo({
      x: index * (CARD_WIDTH + CARD_GAP),
      animated: true,
    });
    setActiveSlide(index);
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={["top", "left", "right"]}>
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.pageContent}
      >
        {/* Header Section */}
        <View style={styles.headerSection}>
          <View style={styles.profileRow}>
            <View style={styles.headerTexts}>
              <Text style={styles.greeting}>Welcome back, {firstName}</Text>
              <Text style={styles.name}>{greeting}</Text>
            </View>
            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push("/profile")}>
                <View style={styles.avatarRight}>
                  <Text style={styles.avatarText}>{firstName.charAt(0).toUpperCase()}</Text>
                </View>
              </Pressable>
              <Pressable onPress={logout} style={styles.logoutBtn}>
                <LogOut size={18} color="#64748B" />
              </Pressable>
            </View>
          </View>

          <View style={styles.timeDateCard}>
            {/* Left: Time */}
            <View style={styles.timeBlock}>
              {/* Row 1: Local Time · PHT */}
              <View style={styles.timeLabelTopRow}>
                <Clock size={11} color="#3B82F6" />
                <Text style={styles.timeLabelTopText}>Local Time · PHT</Text>
              </View>
              {/* Row 2: HH:MM:SS AM/PM */}
              <View style={styles.timeTopRow}>
                <Text style={styles.timeHM}>{timeText.hm}</Text>
                <Text style={styles.timeColon}>:</Text>
                <Text style={styles.timeHM}>{timeText.seconds}</Text>
                <View style={styles.ampmBadge}>
                  <Text style={styles.timeAmPm}>{timeText.ampm}</Text>
                </View>
              </View>
            </View>

            {/* Divider */}
            <View style={styles.timeDivider} />

            {/* Right: Calendar (fully centered) */}
            <View style={styles.calendarBlock}>
              {/* Row 1: Month Year pill - centered */}
              <View style={styles.calendarTop}>
                <Text style={styles.calendarMonth}>{dateInfo.month} {dateInfo.year}</Text>
              </View>
              {/* Row 2: Day Number - centered */}
              <Text style={styles.calendarDay}>{dateInfo.dayNum}</Text>
              {/* Row 3: Day Name - centered */}
              <View style={styles.calendarDayNameRow}>
                <Calendar size={11} color="#94A3B8" />
                <Text style={styles.calendarDayName}>{dateInfo.dayName}</Text>
              </View>
            </View>
          </View>
        </View>

        {/* Weather Slider */}
        {weather.status === "loading" ? (
          <View style={[styles.loadingBox, { marginHorizontal: PAGE_PADDING }]}>
            <ActivityIndicator size="small" color="#0F172A" />
            <Text style={styles.loadingText}>Loading current weather...</Text>
          </View>
        ) : weather.status === "error" ? (
          <View style={[styles.errorBox, { marginHorizontal: PAGE_PADDING }]}>
            <MapPin size={24} color="#64748B" style={{ marginBottom: 12 }} />
            <Text style={styles.errorTitle}>Weather unavailable</Text>
            <Text style={styles.errorText}>
              Please allow location permission and check your connection.
            </Text>
          </View>
        ) : (
          <View>
            <ScrollView
              ref={horizontalScrollRef}
              horizontal
              nestedScrollEnabled
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={{
                paddingHorizontal: PAGE_PADDING,
                gap: CARD_GAP,
              }}
              snapToInterval={CARD_WIDTH + CARD_GAP}
              decelerationRate="fast"
              disableIntervalMomentum
              onMomentumScrollEnd={handleSlideEnd}
            >
              <TemperatureSlide
                visualType={visualType}
                weatherTitle={weatherTitle}
                temperature={weather.temperature}
                feelsLike={weather.feelsLike}
                locationName={weather.locationName}
              />
              <WindSlide windSpeed={weather.windSpeed} />
              <HumiditySlide humidity={weather.humidity} />
            </ScrollView>

            <View style={styles.pagination}>
              {[0, 1, 2].map((index) => (
                <Pressable
                  key={index}
                  onPress={() => goToSlide(index)}
                  style={[
                    styles.paginationDot,
                    activeSlide === index && styles.paginationDotActive,
                  ]}
                />
              ))}
            </View>
          </View>
        )}

        {/* Quick Actions */}
        <View style={styles.quickActionsSection}>
          <Text style={styles.sectionTitle}>Quick Actions</Text>
          <View style={styles.actionGridBig}>
            <BigActionCard
              icon={<Box size={32} color="#3B82F6" />}
              title="NAP Inventory"
              subtitle="NAP Box Inventory"
              iconBg="#EFF6FF"
              onPress={() => router.push("/naps" as any)}
            />
            <BigActionCard
              icon={<Map size={32} color="#10B981" />}
              title="Teardown"
              subtitle="Teardown Process"
              iconBg="#ECFDF5"
              onPress={() => router.push("/teardowns" as any)}
            />
          </View>
        </View>

      </ScrollView>
    </SafeAreaView>
  );
}

function TemperatureSlide({
  visualType,
  weatherTitle,
  temperature,
  feelsLike,
  locationName,
}: {
  visualType: WeatherVisualType;
  weatherTitle: string;
  temperature: number | null;
  feelsLike: number | null;
  locationName: string;
}) {
  const tempDisplay =
    temperature !== null ? `${Math.round(temperature)}` : "--";
  const feelsLikeDisplay =
    feelsLike !== null ? `${Math.round(feelsLike)}` : "--";

  return (
    <View style={styles.slideContainer}>
      <ImageBackground
        source={getBackgroundImage(visualType)}
        style={styles.weatherBg}
        imageStyle={{ borderRadius: 28 }}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(0,0,0,0.15)", "rgba(15,23,42,0.85)"]}
          style={styles.weatherGradient}
        >
          <View style={styles.weatherTopRow}>
            <View style={styles.locationBadge}>
              <MapPin size={12} color="#FFFFFF" style={{ marginRight: 6 }} />
              <Text style={styles.locationBadgeText} numberOfLines={1}>
                {locationName}
              </Text>
            </View>
            <View style={styles.weatherIconWrapper}>
              <Image
                source={getWeatherIcon(visualType)}
                style={styles.weatherIconImage}
                resizeMode="contain"
              />
            </View>
          </View>

          <View style={styles.weatherBottom}>
            <View style={styles.tempRow}>
              <Text style={styles.bigTemp}>{tempDisplay}°</Text>
              <View style={styles.tempDivider} />
              <View style={styles.hlContainer}>
                <Text style={styles.weatherCondition}>{weatherTitle}</Text>
                <Text style={styles.feelsLikeText}>
                  Feels like {feelsLikeDisplay}°
                </Text>
              </View>
            </View>
          </View>
        </LinearGradient>
      </ImageBackground>
    </View>
  );
}

function WindSlide({ windSpeed }: { windSpeed: number | null }) {
  const windDisplay = windSpeed !== null ? Math.round(windSpeed) : "--";

  return (
    <View style={styles.slideContainer}>
      <View style={[styles.metricCard, { backgroundColor: "#FFFFFF" }]}>
        <View style={styles.metricHeader}>
          <View style={[styles.iconBox, { backgroundColor: "#F0F9FF" }]}>
            <Wind size={24} color="#0EA5E9" />
          </View>
          <Text style={styles.metricCardTitle}>Wind Speed</Text>
        </View>

        <View style={styles.metricBody}>
          <Text style={styles.metricValue}>{windDisplay}</Text>
          <Text style={styles.metricUnit}>km/h</Text>
        </View>

        <Text style={styles.metricSubtext}>
          Current wind reading based on your detected location.
        </Text>
      </View>
    </View>
  );
}

function HumiditySlide({ humidity }: { humidity: number | null }) {
  const humidityDisplay = humidity !== null ? Math.round(humidity) : "--";

  return (
    <View style={styles.slideContainer}>
      <View style={[styles.metricCard, { backgroundColor: "#FFFFFF" }]}>
        <View style={styles.metricHeader}>
          <View style={[styles.iconBox, { backgroundColor: "#FDF4FF" }]}>
            <Droplets size={24} color="#D946EF" />
          </View>
          <Text style={styles.metricCardTitle}>Humidity</Text>
        </View>

        <View style={styles.metricBody}>
          <Text style={styles.metricValue}>{humidityDisplay}</Text>
          <Text style={styles.metricUnit}>%</Text>
        </View>

        <Text style={styles.metricSubtext}>
          Moisture levels indicating rain potential and field comfort.
        </Text>
      </View>
    </View>
  );
}

function BigActionCard({
  icon,
  title,
  subtitle,
  iconBg,
  onPress,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  iconBg: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.actionCardBig} onPress={onPress}>
      <View style={[styles.actionIconBoxBig, { backgroundColor: iconBg }]}>
        {icon}
      </View>
      <View style={styles.actionTextContentBig}>
        <Text style={styles.actionTitleBig}>{title}</Text>
        <Text style={styles.actionSubtitleBig}>{subtitle}</Text>
      </View>
    </Pressable>
  );
}

function isNightTime(now: Date) {
  const hour = now.getUTCHours();
  return hour < 6 || hour >= 18;
}

function getWeatherVisualType(
  code: number | null,
  now: Date
): WeatherVisualType {
  if (isNightTime(now)) {
    if (
      code !== null &&
      [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)
    ) {
      return "rainy";
    }
    return "night";
  }

  if (code === 0) return "sunny";
  if (code !== null && [1, 2].includes(code)) return "partlyCloudy";
  if (code !== null && [3].includes(code)) return "cloudy";
  if (code !== null && [45, 48].includes(code)) return "foggy";
  if (
    code !== null &&
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)
  )
    return "rainy";
  if (code !== null && [95, 96, 99].includes(code)) return "thunderstorm";

  return "cloudy";
}

function getWeatherTitle(code: number | null): string {
  if (code === 0) return "Clear sky";
  if (code !== null && [1, 2].includes(code)) return "Partly cloudy";
  if (code !== null && [3].includes(code)) return "Cloudy";
  if (code !== null && [45, 48].includes(code)) return "Foggy";
  if (
    code !== null &&
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)
  )
    return "Rainy";
  if (code !== null && [95, 96, 99].includes(code)) return "Thunderstorm";

  return "Cloudy";
}

function getBackgroundImage(type: WeatherVisualType) {
  if (type === "sunny") return WEATHER_BACKGROUNDS.sunny;
  if (type === "partlyCloudy") return WEATHER_BACKGROUNDS.partlyCloudy;
  if (type === "rainy") return WEATHER_BACKGROUNDS.rainy;
  if (type === "thunderstorm") return WEATHER_BACKGROUNDS.thunderstorm;
  if (type === "foggy") return WEATHER_BACKGROUNDS.foggy;
  if (type === "night") return WEATHER_BACKGROUNDS.night;
  return WEATHER_BACKGROUNDS.cloudy;
}

function getWeatherIcon(type: WeatherVisualType) {
  if (type === "sunny") return WEATHER_ICONS.sunny;
  if (type === "partlyCloudy") return WEATHER_ICONS.cloudySunny;
  if (type === "rainy") return WEATHER_ICONS.rain;
  if (type === "thunderstorm") return WEATHER_ICONS.thunder;
  if (type === "foggy") return WEATHER_ICONS.cloudy;
  if (type === "night") return WEATHER_ICONS.night;
  return WEATHER_ICONS.cloudy;
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: "#F8FAFC",
  },
  pageContent: {
    paddingBottom: 100,
  },

  // --- Header Section ---
  headerSection: {
    paddingHorizontal: PAGE_PADDING,
    paddingTop: 16,
    paddingBottom: 24,
  },
  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 20,
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  logoutBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: "#F1F5F9",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarRight: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#0F172A",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 3,
  },
  avatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "800",
  },
  headerTexts: {
    flex: 1,
    marginRight: 16,
  },
  greeting: {
    fontSize: 12,
    fontWeight: "600",
    color: "#64748B",
    marginBottom: 2,
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  name: {
    fontSize: 20,
    fontWeight: "800",
    color: "#0F172A",
  },
  timeDateCard: {
    flexDirection: "row",
    alignItems: "flex-start",
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 24,
    marginTop: 10,
    gap: 0,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 20,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#F1F5F9",
  },
  timeBlock: {
    flex: 1,
  },
  timeLabelTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    height: 32,
    marginBottom: 6,
  },
  timeLabelTopText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#3B82F6",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  ampmBadge: {
    backgroundColor: "#EFF6FF",
    borderRadius: 5,
    paddingHorizontal: 5,
    paddingVertical: 2,
    marginLeft: 4,
    alignSelf: "flex-end",
    marginBottom: 6,
  },
  timeAmPm: {
    fontSize: 10,
    fontWeight: "900",
    color: "#3B82F6",
    letterSpacing: 0.3,
  },
  timeTopRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 4,
  },
  timeHM: {
    fontSize: 36,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -1,
    lineHeight: 40,
  },
  timeColon: {
    fontSize: 30,
    fontWeight: "900",
    color: "#CBD5E1",
    lineHeight: 40,
    marginHorizontal: 0,
    includeFontPadding: false,
  },
  timeLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginTop: 8,
    gap: 4,
  },
  timeLabelText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginLeft: 4,
  },
  timeDivider: {
    width: 1.5,
    alignSelf: "stretch",
    backgroundColor: "#E2E8F0",
    borderRadius: 2,
    marginHorizontal: 20,
  },
  calendarBlock: {
    alignItems: "center",
    justifyContent: "flex-start",
    minWidth: 90,
  },
  calendarTop: {
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    paddingVertical: 0,
    borderRadius: 8,
    marginBottom: 6,
    height: 32,
    justifyContent: "center",
    alignItems: "center",
  },
  calendarMonth: {
    fontSize: 10,
    fontWeight: "800",
    color: "#FFFFFF",
    letterSpacing: 0.5,
    textTransform: "uppercase",
  },
  calendarDay: {
    fontSize: 48,
    fontWeight: "900",
    color: "#0F172A",
    lineHeight: 52,
    letterSpacing: -1.5,
    textAlign: "center",
  },
  calendarDayNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginTop: 8,
  },
  calendarDayName: {
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
    letterSpacing: 0.4,
    textTransform: "uppercase",
    marginLeft: 3,
  },

  // --- States ---
  loadingBox: {
    height: 220,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.04,
    shadowRadius: 24,
    elevation: 3,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "600",
    color: "#64748B",
  },
  errorBox: {
    height: 220,
    borderRadius: 28,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.04,
    shadowRadius: 24,
    elevation: 3,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 6,
  },
  errorText: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748B",
    textAlign: "center",
    lineHeight: 18,
  },

  // --- Sliders ---
  slideContainer: {
    width: CARD_WIDTH,
    height: 220,
    borderRadius: 28,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.06,
    shadowRadius: 24,
    elevation: 4,
    backgroundColor: "#FFFFFF",
  },
  weatherBg: {
    width: "100%",
    height: "100%",
    borderRadius: 28,
  },
  weatherGradient: {
    flex: 1,
    borderRadius: 28,
    padding: 20,
    justifyContent: "space-between",
  },
  weatherTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "flex-start",
  },
  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(0,0,0,0.3)",
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 100,
    maxWidth: "70%",
  },
  locationBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  weatherIconWrapper: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.3)",
  },
  weatherIconImage: {
    width: 32,
    height: 32,
  },
  weatherBottom: {
    marginTop: "auto",
  },
  tempRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  bigTemp: {
    fontSize: 56,
    fontWeight: "900",
    color: "#FFFFFF",
    letterSpacing: -2,
  },
  tempDivider: {
    width: 1,
    height: 40,
    backgroundColor: "rgba(255,255,255,0.3)",
    marginHorizontal: 16,
  },
  hlContainer: {
    justifyContent: "center",
  },
  weatherCondition: {
    fontSize: 16,
    fontWeight: "800",
    color: "#FFFFFF",
    marginBottom: 4,
  },
  feelsLikeText: {
    fontSize: 13,
    fontWeight: "600",
    color: "rgba(255,255,255,0.8)",
  },

  metricCard: {
    flex: 1,
    borderRadius: 28,
    padding: 24,
  },
  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },
  iconBox: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  metricCardTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#0F172A",
  },
  metricBody: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 8,
  },
  metricValue: {
    fontSize: 48,
    fontWeight: "900",
    color: "#0F172A",
    letterSpacing: -1.5,
    marginRight: 8,
  },
  metricUnit: {
    fontSize: 18,
    fontWeight: "700",
    color: "#64748B",
  },
  metricSubtext: {
    fontSize: 13,
    fontWeight: "500",
    color: "#94A3B8",
    lineHeight: 18,
  },

  pagination: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    marginTop: 20,
    marginBottom: 8,
  },
  paginationDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#CBD5E1",
    marginHorizontal: 4,
  },
  paginationDotActive: {
    width: 20,
    backgroundColor: "#0F172A",
  },

  // --- Quick Actions ---
  quickActionsSection: {
    paddingHorizontal: PAGE_PADDING,
    marginTop: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 16,
  },
  actionGridBig: {
    flexDirection: "column",
    gap: 12,
  },
  actionCardBig: {
    width: CARD_WIDTH,
    backgroundColor: "#FFFFFF",
    padding: 20,
    borderRadius: 24,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
    elevation: 3,
    borderWidth: 1,
    borderColor: "#F1F5F9",
    flexDirection: "row",
    alignItems: "center",
    gap: 16,
  },
  actionIconBoxBig: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  actionTextContentBig: {
    flex: 1,
    alignItems: "flex-start",
  },
  actionTitleBig: {
    fontSize: 16,
    fontWeight: "800",
    color: "#0F172A",
    marginBottom: 6,
  },
  actionSubtitleBig: {
    fontSize: 13,
    fontWeight: "500",
    color: "#64748B",
    lineHeight: 18,
  },
});

