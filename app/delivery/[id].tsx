import { useAuth } from "@/context/auth-context";
import { DELIVERY_STATUS_COLORS, DELIVERY_STATUS_LABELS, getDeliveries, type TeardownDelivery } from "@/services/skycable";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { ChevronLeft, Hash } from "lucide-react-native";
import { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

const G="#0B7A5A",SLATE="#111827",MUTED="#667085",BORDER="#E7ECF2",WHITE="#FFFFFF";

function fmtDate(d:string){const[y,m,day]=d.split("-").map(Number);return`${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m-1]} ${day}, ${y}`;}
function fmtDT(iso:string){const d=new Date(new Date(iso).getTime()+8*3600000);const h=d.getUTCHours(),mi=String(d.getUTCMinutes()).padStart(2,"0");return`${d.getUTCMonth()+1}/${d.getUTCDate()} ${h%12||12}:${mi}${h>=12?"PM":"AM"}`;}

export default function DeliveryDetail() {
  const router=useRouter();
  const {id}=useLocalSearchParams<{id:string}>();
  const {token}=useAuth();
  const [delivery,setDelivery]=useState<TeardownDelivery|null>(null);
  const [loading,setLoading]=useState(true);

  useEffect(()=>{
    if(!token||!id)return;
    getDeliveries(token).then(list=>setDelivery(list.find(d=>String(d.id)===id)??null)).finally(()=>setLoading(false));
  },[token,id]);

  if(loading)return(<><Stack.Screen options={{headerShown:false}}/><SafeAreaView style={s.container}><View style={s.center}><ActivityIndicator size="large" color={G}/></View></SafeAreaView></>);
  if(!delivery)return null;

  const color=DELIVERY_STATUS_COLORS[delivery.status]??"#64748b";
  const moves=delivery.movements??[];

  return(
    <>
      <Stack.Screen options={{headerShown:false}}/>
      <SafeAreaView style={s.container}>
        <View style={s.header}>
          <TouchableOpacity onPress={()=>router.back()} style={s.backBtn}><ChevronLeft size={22} color={SLATE}/></TouchableOpacity>
          <View style={s.headerText}>
            <View style={{flexDirection:"row",alignItems:"center",gap:4}}><Hash size={14} color={G}/><Text style={s.title}>{delivery.token}</Text></View>
            <Text style={s.subtitle}>{fmtDate(delivery.date)}</Text>
          </View>
        </View>

        <ScrollView contentContainerStyle={s.scroll}>
          {/* Status */}
          <View style={[s.statusCard,{borderColor:color+"44"}]}>
            <View style={[s.badge,{backgroundColor:color+"18"}]}>
              <View style={[s.dot,{backgroundColor:color}]}/>
              <Text style={[s.badgeTxt,{color}]}>{DELIVERY_STATUS_LABELS[delivery.status]}</Text>
            </View>
            {delivery.current_location&&<Text style={s.loc}>📍 {delivery.current_location}</Text>}
          </View>

          {/* Totals */}
          <Text style={s.sLabel}>COLLECTED ITEMS</Text>
          <View style={s.grid}>
            {([["Cable",delivery.total_cable,"m","#059669"],["Node",delivery.total_node,"","#0b6cff"],["Amplifier",delivery.total_amplifier,"","#8b5cf6"],["Extender",delivery.total_extender,"","#10b981"],["TSC",delivery.total_tsc,"","#f59e0b"],["Power Supply",delivery.total_psu,"","#ef4444"],["PSU Case",delivery.total_psu_case,"","#64748b"]] as [string,number,string,string][]).map(([l,v,u,c])=>(
              <View key={l} style={s.gridItem}>
                <Text style={[s.gridVal,{color:c}]}>{v>0?`${v}${u}`:"—"}</Text>
                <Text style={s.gridLbl}>{l}</Text>
              </View>
            ))}
          </View>

          {/* Chain of custody */}
          <Text style={s.sLabel}>CHAIN OF CUSTODY — {moves.length} MOVEMENT{moves.length!==1?"S":""}</Text>
          {moves.length===0?<Text style={s.noMov}>No movements recorded yet.</Text>:moves.map((m,i)=>{
            const mc=DELIVERY_STATUS_COLORS[m.to_stage as any]??G;
            return(
              <View key={m.id??i} style={s.tlRow}>
                <View style={s.tlLeft}>
                  <View style={[s.tlDot,{backgroundColor:mc}]}/>
                  {i<moves.length-1&&<View style={s.tlLine}/>}
                </View>
                <View style={s.tlContent}>
                  <Text style={s.tlStage}>{DELIVERY_STATUS_LABELS[m.to_stage as any]??m.to_stage}</Text>
                  <Text style={s.tlLoc}>{m.location_name}</Text>
                  {m.notes&&<Text style={s.tlNote}>📝 {m.notes}</Text>}
                  <Text style={s.tlBy}>{m.moved_by?`by ${m.moved_by.name} · `:""}{fmtDT(m.timestamp)}</Text>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </SafeAreaView>
    </>
  );
}

const s=StyleSheet.create({
  container:{flex:1,backgroundColor:"#F8FAFC"},
  header:{flexDirection:"row",alignItems:"center",paddingHorizontal:16,paddingVertical:12,backgroundColor:WHITE,borderBottomWidth:1,borderBottomColor:BORDER,gap:8},
  backBtn:{width:40,height:40,borderRadius:20,alignItems:"center",justifyContent:"center"},
  headerText:{flex:1},title:{fontSize:18,fontWeight:"900",color:SLATE},
  subtitle:{fontSize:12,color:MUTED,fontWeight:"600"},
  center:{flex:1,alignItems:"center",justifyContent:"center"},
  scroll:{padding:16,paddingBottom:48,gap:14},
  statusCard:{backgroundColor:WHITE,borderRadius:18,padding:14,borderWidth:1.5,gap:6},
  badge:{flexDirection:"row",alignItems:"center",gap:6,paddingHorizontal:12,paddingVertical:6,borderRadius:999,alignSelf:"flex-start"},
  dot:{width:7,height:7,borderRadius:4},
  badgeTxt:{fontSize:13,fontWeight:"900"},
  loc:{fontSize:12,color:MUTED,fontWeight:"600"},
  sLabel:{fontSize:9,fontWeight:"900",color:MUTED,letterSpacing:1,textTransform:"uppercase"},
  grid:{flexDirection:"row",flexWrap:"wrap",gap:8},
  gridItem:{flex:1,minWidth:80,backgroundColor:WHITE,borderRadius:14,padding:12,alignItems:"center",borderWidth:1,borderColor:BORDER},
  gridVal:{fontSize:18,fontWeight:"900"},
  gridLbl:{fontSize:10,fontWeight:"700",color:MUTED,marginTop:2,textTransform:"uppercase"},
  noMov:{fontSize:13,color:MUTED,fontStyle:"italic"},
  tlRow:{flexDirection:"row",gap:12},
  tlLeft:{alignItems:"center",width:18},
  tlDot:{width:14,height:14,borderRadius:7},
  tlLine:{width:2,flex:1,backgroundColor:BORDER,marginTop:4},
  tlContent:{flex:1,paddingBottom:16},
  tlStage:{fontSize:14,fontWeight:"900",color:SLATE},
  tlLoc:{fontSize:12,color:"#0b6cff",fontWeight:"700"},
  tlNote:{fontSize:11,color:MUTED,fontStyle:"italic",marginTop:2},
  tlBy:{fontSize:10,color:"#94A3B8",marginTop:3},
});
