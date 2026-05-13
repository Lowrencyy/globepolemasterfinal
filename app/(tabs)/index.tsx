import { useAuth } from "@/context/auth-context";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { useRouter } from "expo-router";
import type { ReactNode } from "react";
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

import {
  SafeAreaView,
  useSafeAreaInsets,
} from "react-native-safe-area-context";

import { saveDisplayTime } from "@/lib/display-time";

import {
  Box,
  Calendar,
  ChevronRight,
  Clock,
  Droplets,
  Map,
  MapPin,
  Sparkles,
  Wind,
} from "lucide-react-native";

const { width } = Dimensions.get("window");

const PAGE_PADDING = 22;
const CARD_WIDTH = width - PAGE_PADDING * 2;
const CARD_GAP = 16;
const ACTION_CARD_HEIGHT = 86;

const WEATHER_BACKGROUNDS = {
  sunny: require("@/assets/images/weather-image/sunny.jpg"),
  cloudy: require("@/assets/images/weather-image/cloudy.jpg"),
  partlyCloudy: require("@/assets/images/weather-image/partly_cloudy.jpg"),
  rainy: require("@/assets/images/weather-image/rainy.jpg"),
  thunderstorm: require("@/assets/images/weather-image/thunderstorm.jpg"),
  foggy: require("@/assets/images/weather-image/foggy.jpg"),
  night: require("@/assets/images/weather-image/night.jpg"),
};

const WEATHER_ICONS = {
  sunny: require("@/assets/images/weather-icons/sunny.png"),
  cloudy: require("@/assets/images/weather-icons/cloudy.png"),
  cloudySunny: require("@/assets/images/weather-icons/cloudy-sunny.png"),
  thunder: require("@/assets/images/weather-icons/cloudy-thunder.png"),
  rain: require("@/assets/images/weather-icons/rainy.png"),
  night: require("@/assets/images/weather-icons/night.png"),
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

export default function HomeScreen() {
  const { user } = useAuth();
  const router = useRouter();
  const firstName = user?.first_name ?? "User";
  const insets = useSafeAreaInsets();

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

  useEffect(() => {
    saveDisplayTime();

    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        saveDisplayTime();
      }
    });

    return () => sub.remove();
  }, []);

  useEffect(() => {
    const WEATHER_KEY = "cached_weather";

    const loadWeather = async () => {
      try {
        const raw = await AsyncStorage.getItem(WEATHER_KEY);

        if (raw) {
          const cached: WeatherState = JSON.parse(raw);

          setWeather({
            ...cached,
            status: "ready",
          });
        }
      } catch {}

      try {
        const permission = await Location.requestForegroundPermissionsAsync();

        if (permission.status !== "granted") {
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        const { latitude, longitude } = currentLocation.coords;

        const reverseGeo = await Location.reverseGeocodeAsync({
          latitude,
          longitude,
        });

        const place = reverseGeo[0];

        const locationName =
          place?.city ||
          place?.subregion ||
          place?.region ||
          "Current Location";

        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code`,
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
      } catch {}
    };

    loadWeather();
  }, []);

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

    hours = hours % 12 || 12;

    return {
      hm: `${hours}:${minutes}`,
      seconds,
      ampm,
    };
  }, [pht]);

  const dateInfo = useMemo(() => {
    const dayNames = [
      "Sunday",
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
    ];

    const monthNames = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];

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
        <View
          style={[
            styles.headerSection,
            {
              paddingTop: Math.max(insets.top + 6, 14),
            },
          ]}
        >
          <View style={styles.profileRow}>
            <View style={styles.headerTexts}>
              <Text style={styles.greeting}>Welcome back, {firstName}</Text>
              <Text style={styles.name}>{greeting}</Text>
            </View>

            <View style={styles.headerActions}>
              <Pressable onPress={() => router.push("/profile")}>
                <LinearGradient
                  colors={["#0F172A", "#1E3A8A"]}
                  style={styles.avatarRight}
                >
                  <Text style={styles.avatarText}>
                    {firstName.charAt(0).toUpperCase()}
                  </Text>
                </LinearGradient>
              </Pressable>
            </View>
          </View>

          <LinearGradient
            colors={["#FFFFFF", "#F8FBFF"]}
            style={styles.timeDateCard}
          >
            <View style={styles.cardGlow} />

            <View style={styles.timeBlock}>
              <View style={styles.timeLabelTopRow}>
                <View style={styles.tinyIconBadge}>
                  <Clock size={11} color="#2563EB" />
                </View>

                <Text style={styles.timeLabelTopText}>LOCAL TIME · PHT</Text>
              </View>

              <View style={styles.timeTopRow}>
                <Text style={styles.timeHM}>{timeText.hm}</Text>
                <Text style={styles.timeColon}>:</Text>
                <Text style={styles.timeSeconds}>{timeText.seconds}</Text>

                <View style={styles.ampmBadge}>
                  <Text style={styles.timeAmPm}>{timeText.ampm}</Text>
                </View>
              </View>

              <Text style={styles.timeHint}>
                Synced to Philippine Standard Time
              </Text>
            </View>

            <View style={styles.timeDivider} />

            <View style={styles.calendarBlock}>
              <View style={styles.calendarTop}>
                <Text style={styles.calendarMonth}>
                  {dateInfo.month} {dateInfo.year}
                </Text>
              </View>

              <Text style={styles.calendarDay}>{dateInfo.dayNum}</Text>

              <View style={styles.calendarDayNameRow}>
                <Calendar size={11} color="#94A3B8" />
                <Text style={styles.calendarDayName}>{dateInfo.dayName}</Text>
              </View>
            </View>
          </LinearGradient>
        </View>

        {weather.status === "loading" ? (
          <View
            style={[
              styles.loadingBox,
              {
                marginHorizontal: PAGE_PADDING,
              },
            ]}
          >
            <ActivityIndicator size="small" color="#0F172A" />
            <Text style={styles.loadingText}>Loading current weather...</Text>
          </View>
        ) : (
          <View>
            <ScrollView
              ref={horizontalScrollRef}
              horizontal
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

        <View style={styles.quickActionsSection}>
          <View style={styles.sectionHeaderRow}>
            <View>
              <Text style={styles.sectionEyebrow}>START FASTER</Text>
              <Text style={styles.sectionTitle}>Quick Actions</Text>
            </View>

            <View style={styles.sectionBadge}>
              <Sparkles size={13} color="#2563EB" />
              <Text style={styles.sectionBadgeText}>Tools</Text>
            </View>
          </View>

          <View style={styles.actionGridBig}>
            <BigActionCard
              icon={<Box size={24} color="#2563EB" />}
              title="NAP Inventory"
              subtitle="Manage NAP box inventory"
              iconBg="#EFF6FF"
              accentColor="#2563EB"
              onPress={() => router.push("/naps" as any)}
            />

            <BigActionCard
              icon={<Map size={24} color="#059669" />}
              title="Teardown"
              subtitle="Open teardown process"
              iconBg="#ECFDF5"
              accentColor="#059669"
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
        imageStyle={{
          borderRadius: 30,
        }}
        resizeMode="cover"
      >
        <LinearGradient
          colors={["rgba(0,0,0,0.08)", "rgba(15,23,42,0.88)"]}
          style={styles.weatherGradient}
        >
          <View style={styles.weatherTopRow}>
            <View style={styles.locationBadge}>
              <MapPin
                size={12}
                color="#FFFFFF"
                style={{
                  marginRight: 6,
                }}
              />

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
      <LinearGradient colors={["#FFFFFF", "#F0F9FF"]} style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <View style={[styles.iconBox, { backgroundColor: "#E0F2FE" }]}>
            <Wind size={24} color="#0284C7" />
          </View>

          <View>
            <Text style={styles.metricCardTitle}>Wind Speed</Text>
            <Text style={styles.metricMiniLabel}>Live reading</Text>
          </View>
        </View>

        <View style={styles.metricBody}>
          <Text style={styles.metricValue}>{windDisplay}</Text>
          <Text style={styles.metricUnit}>km/h</Text>
        </View>

        <Text style={styles.metricSubtext}>
          Current wind reading based on your detected location.
        </Text>
      </LinearGradient>
    </View>
  );
}

function HumiditySlide({ humidity }: { humidity: number | null }) {
  const humidityDisplay = humidity !== null ? Math.round(humidity) : "--";

  return (
    <View style={styles.slideContainer}>
      <LinearGradient colors={["#FFFFFF", "#FDF4FF"]} style={styles.metricCard}>
        <View style={styles.metricHeader}>
          <View style={[styles.iconBox, { backgroundColor: "#FAE8FF" }]}>
            <Droplets size={24} color="#C026D3" />
          </View>

          <View>
            <Text style={styles.metricCardTitle}>Humidity</Text>
            <Text style={styles.metricMiniLabel}>Comfort level</Text>
          </View>
        </View>

        <View style={styles.metricBody}>
          <Text style={styles.metricValue}>{humidityDisplay}</Text>
          <Text style={styles.metricUnit}>%</Text>
        </View>

        <Text style={styles.metricSubtext}>
          Moisture levels indicating rain potential and field comfort.
        </Text>
      </LinearGradient>
    </View>
  );
}

function BigActionCard({
  icon,
  title,
  subtitle,
  iconBg,
  accentColor,
  onPress,
}: {
  icon: ReactNode;
  title: string;
  subtitle: string;
  iconBg: string;
  accentColor: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [
        styles.actionCardBig,
        pressed && styles.actionCardPressed,
      ]}
      onPress={onPress}
    >
      <View style={[styles.actionAccent, { backgroundColor: accentColor }]} />

      <View style={styles.actionLeftCluster}>
        <View style={[styles.actionIconBoxBig, { backgroundColor: iconBg }]}>
          {icon}
        </View>

        <View style={styles.actionArrow}>
          <ChevronRight size={17} color="#94A3B8" />
        </View>
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
  now: Date,
): WeatherVisualType {
  if (isNightTime(now)) return "night";

  if (code === 0) return "sunny";
  if (code !== null && [1, 2].includes(code)) return "partlyCloudy";
  if (code !== null && [3].includes(code)) return "cloudy";
  if (code !== null && [45, 48].includes(code)) return "foggy";

  if (
    code !== null &&
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)
  ) {
    return "rainy";
  }

  if (code !== null && [95, 96, 99].includes(code)) return "thunderstorm";

  return "cloudy";
}

function getWeatherTitle(code: number | null) {
  if (code === 0) return "Clear sky";
  if (code !== null && [1, 2].includes(code)) return "Partly cloudy";
  if (code !== null && [3].includes(code)) return "Cloudy";
  if (code !== null && [45, 48].includes(code)) return "Foggy";

  if (
    code !== null &&
    [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)
  ) {
    return "Rainy";
  }

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

  headerSection: {
    paddingHorizontal: PAGE_PADDING,
    paddingBottom: 22,
  },

  profileRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 18,
  },

  headerTexts: {
    flex: 1,
  },

  greeting: {
    fontSize: 12,
    fontWeight: "700",
    color: "#64748B",
    marginBottom: 4,
    letterSpacing: 0.6,
  },

  name: {
    fontSize: 24,
    fontWeight: "900",
    color: "#0F172A",
  },

  headerActions: {
    flexDirection: "row",
    alignItems: "center",
  },

  avatarRight: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
  },

  avatarText: {
    color: "#FFFFFF",
    fontSize: 18,
    fontWeight: "900",
  },

  timeDateCard: {
    overflow: "hidden",
    flexDirection: "row",
    padding: 18,
    borderRadius: 30,
    borderWidth: 1,
    borderColor: "#EAF0F7",
  },

  cardGlow: {
    position: "absolute",
    top: -48,
    right: -36,
    width: 130,
    height: 130,
    borderRadius: 65,
    backgroundColor: "rgba(37,99,235,0.09)",
  },

  timeBlock: {
    flex: 1,
  },

  timeLabelTopRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 7,
    marginBottom: 10,
  },

  tinyIconBadge: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: "#DBEAFE",
    alignItems: "center",
    justifyContent: "center",
  },

  timeLabelTopText: {
    fontSize: 11,
    fontWeight: "800",
    color: "#2563EB",
  },

  timeTopRow: {
    flexDirection: "row",
    alignItems: "baseline",
  },

  timeHM: {
    fontSize: 39,
    fontWeight: "900",
    color: "#0F172A",
  },

  timeColon: {
    fontSize: 31,
    fontWeight: "900",
    color: "#CBD5E1",
  },

  timeSeconds: {
    fontSize: 25,
    fontWeight: "900",
    color: "#334155",
  },

  ampmBadge: {
    backgroundColor: "#EFF6FF",
    borderRadius: 9,
    paddingHorizontal: 7,
    paddingVertical: 3,
    marginLeft: 7,
  },

  timeAmPm: {
    fontSize: 10,
    fontWeight: "900",
    color: "#2563EB",
  },

  timeHint: {
    marginTop: 8,
    fontSize: 11,
    fontWeight: "600",
    color: "#94A3B8",
  },

  timeDivider: {
    width: 1,
    backgroundColor: "#E2E8F0",
    marginHorizontal: 18,
  },

  calendarBlock: {
    alignItems: "center",
    justifyContent: "center",
  },

  calendarTop: {
    backgroundColor: "#0F172A",
    paddingHorizontal: 12,
    borderRadius: 999,
    height: 28,
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 7,
  },

  calendarMonth: {
    color: "#FFFFFF",
    fontSize: 10,
    fontWeight: "900",
  },

  calendarDay: {
    fontSize: 52,
    fontWeight: "900",
    color: "#0F172A",
  },

  calendarDayNameRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },

  calendarDayName: {
    fontSize: 10.5,
    fontWeight: "800",
    color: "#94A3B8",
  },

  loadingBox: {
    height: 220,
    borderRadius: 30,
    backgroundColor: "#FFFFFF",
    alignItems: "center",
    justifyContent: "center",
  },

  loadingText: {
    marginTop: 12,
    fontSize: 14,
    fontWeight: "700",
    color: "#64748B",
  },

  slideContainer: {
    width: CARD_WIDTH,
    height: 220,
    borderRadius: 30,
    overflow: "hidden",
  },

  weatherBg: {
    width: "100%",
    height: "100%",
  },

  weatherGradient: {
    flex: 1,
    padding: 20,
    justifyContent: "space-between",
  },

  weatherTopRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },

  locationBadge: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "rgba(15,23,42,0.38)",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
  },

  locationBadgeText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "800",
  },

  weatherIconWrapper: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "rgba(255,255,255,0.22)",
    alignItems: "center",
    justifyContent: "center",
  },

  weatherIconImage: {
    width: 34,
    height: 34,
  },

  weatherBottom: {
    marginTop: "auto",
  },

  tempRow: {
    flexDirection: "row",
    alignItems: "center",
  },

  bigTemp: {
    fontSize: 58,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  tempDivider: {
    width: 1,
    height: 42,
    backgroundColor: "rgba(255,255,255,0.35)",
    marginHorizontal: 16,
  },

  hlContainer: {
    flex: 1,
  },

  weatherCondition: {
    fontSize: 17,
    fontWeight: "900",
    color: "#FFFFFF",
  },

  feelsLikeText: {
    fontSize: 13,
    fontWeight: "700",
    color: "rgba(255,255,255,0.82)",
  },

  metricCard: {
    flex: 1,
    borderRadius: 30,
    padding: 24,
  },

  metricHeader: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 24,
  },

  iconBox: {
    width: 50,
    height: 50,
    borderRadius: 18,
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },

  metricCardTitle: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
  },

  metricMiniLabel: {
    fontSize: 12,
    fontWeight: "700",
    color: "#94A3B8",
  },

  metricBody: {
    flexDirection: "row",
    alignItems: "baseline",
    marginBottom: 8,
  },

  metricValue: {
    fontSize: 52,
    fontWeight: "900",
    color: "#0F172A",
  },

  metricUnit: {
    fontSize: 18,
    fontWeight: "800",
    color: "#64748B",
  },

  metricSubtext: {
    fontSize: 13,
    fontWeight: "600",
    color: "#94A3B8",
  },

  pagination: {
    flexDirection: "row",
    justifyContent: "center",
    marginTop: 18,
    marginBottom: 8,
  },

  paginationDot: {
    width: 7,
    height: 7,
    borderRadius: 4,
    backgroundColor: "#CBD5E1",
    marginHorizontal: 4,
  },

  paginationDotActive: {
    width: 22,
    backgroundColor: "#0F172A",
  },

  quickActionsSection: {
    paddingHorizontal: PAGE_PADDING,
    marginTop: 18,
  },

  sectionHeaderRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 14,
  },

  sectionEyebrow: {
    fontSize: 11,
    fontWeight: "800",
    color: "#2563EB",
  },

  sectionTitle: {
    fontSize: 21,
    fontWeight: "900",
    color: "#0F172A",
  },

  sectionBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 7,
  },

  sectionBadgeText: {
    fontSize: 11,
    fontWeight: "900",
    color: "#2563EB",
  },

  actionGridBig: {
    flexDirection: "column",
    gap: 12,
  },

  actionCardBig: {
    position: "relative",
    overflow: "hidden",
    width: CARD_WIDTH,
    height: ACTION_CARD_HEIGHT,
    backgroundColor: "#FFFFFF",
    paddingHorizontal: 16,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: "#EAF0F7",
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    shadowColor: "#0F172A",
    shadowOffset: {
      width: 0,
      height: 6,
    },
    shadowOpacity: 0.04,
    shadowRadius: 10,
    elevation: 2,
  },

  actionCardPressed: {
    opacity: 0.85,
    transform: [{ scale: 0.985 }],
  },

  actionAccent: {
    position: "absolute",
    left: 0,
    top: 16,
    bottom: 16,
    width: 4,
    borderTopRightRadius: 999,
    borderBottomRightRadius: 999,
  },

  actionLeftCluster: {
    flexDirection: "row",
    alignItems: "center",
  },

  actionIconBoxBig: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
  },

  actionArrow: {
    display: "none",
  },

  actionTextContentBig: {
    flex: 1,
    justifyContent: "center",
  },

  actionTitleBig: {
    fontSize: 17,
    fontWeight: "900",
    color: "#0F172A",
    marginBottom: 2,
  },

  actionSubtitleBig: {
    fontSize: 13,
    fontWeight: "600",
    color: "#64748B",
    lineHeight: 17,
  },
});
