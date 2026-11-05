#include "../backend/capture/src/packet_store.h"
#include <windows.h>
#include <psapi.h>
#include <chrono>
#include <iostream>
#include <stdexcept>
#include <string>

void require(bool value, const char* message) { if (!value) throw std::runtime_error(message); }
std::uint64_t memory() {
    PROCESS_MEMORY_COUNTERS_EX data{};
    if (!GetProcessMemoryInfo(GetCurrentProcess(), reinterpret_cast<PROCESS_MEMORY_COUNTERS*>(&data), sizeof(data))) throw std::runtime_error("Cannot read memory counters");
    return data.PrivateUsage;
}
int main() {
    try {
        using Clock = std::chrono::steady_clock;
        capture::PacketStore store;
        const auto baseline = memory();
        const auto start = Clock::now();
        nlohmann::ordered_json row = { {"frame",0}, {"text",std::string(1024,'x')}, {"reference",u8"测量对象"} };
        for (int i = 0; i < 100000; ++i) { row["frame"] = i; store.append(row); }
        require(store.size() == 100000, "packet count mismatch");
        const auto growth = memory() - baseline;
        require(growth < 40ull * 1024 * 1024, "packet bodies were retained in process memory");
        const auto readStart = Clock::now();
        for (size_t i = 0; i < 1000; ++i) { auto index = i * 97 % store.size(); auto packet = store.at(index); require(packet.at("frame") == index && packet.at("reference") == u8"测量对象", "random lookup corrupted"); }
        const auto readMs = std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now() - readStart).count();
        bool rejected = false; try { store.at(store.size()); } catch (const std::out_of_range&) { rejected = true; }
        require(rejected, "out of range lookup was accepted");
        capture::PacketStore limited(256,128);
        rejected = false; try { limited.append({{"payload",std::string(200,'z')}}); } catch (const std::runtime_error&) { rejected = true; }
        require(rejected && limited.size() == 0, "oversize packet published a partial index");
        limited.append({{"payload",std::string(100,'a')}}); limited.append({{"payload",std::string(100,'b')}});
        rejected = false; try { limited.append({{"payload",std::string(100,'c')}}); } catch (const std::runtime_error&) { rejected = true; }
        require(rejected && limited.size() == 2 && limited.at(1)["payload"] == std::string(100,'b'), "quota failure corrupted previous records");
        std::cout << "PASS 100000 disk-indexed packets / " << store.bytes() << " bytes / private-memory growth " << growth << " bytes / 1000 random reads " << readMs << " ms / total " << std::chrono::duration_cast<std::chrono::milliseconds>(Clock::now()-start).count() << " ms\n";
        store.clear(); require(store.size() == 0 && store.bytes() == 0, "clear failed");
        store.append({{"new",true}}); require(store.at(0)["new"] == true, "store cannot be reused after clear");
        std::cout << "PASS size/quota/lookup failures preserve data; clear and reuse\n";
        return 0;
    } catch (const std::exception& e) { std::cerr << e.what() << '\n'; return 1; }
}
