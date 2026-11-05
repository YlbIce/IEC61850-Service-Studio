#include <chrono>
#include <thread>
#include <iostream>
#include <pcap.h>
int main(int argc, char **argv) {
    if (argc != 3)
        return 2;
    char error[PCAP_ERRBUF_SIZE]{};
    auto *handle = pcap_open_live(argv[1], 65536, 1, 10, error);
    if (!handle) {
        std::cerr << error;
        return 3;
    }
    if (pcap_datalink(handle) != DLT_EN10MB)
        return 4;
    bpf_program filter{};
    if (pcap_compile(handle, &filter,
                     "ether proto 0x88b8 or ether proto 0x88ba or (vlan and (ether proto 0x88b8 or ether "
                     "proto 0x88ba))",
                     1, 0xffffffff) != 0)
        return 5;
    pcap_setfilter(handle, &filter);
    pcap_freecode(&filter);
    if (pcap_setnonblock(handle, 1, error) < 0)
        return 6;
    auto *dump = pcap_dump_open(handle, argv[2]);
    if (!dump)
        return 7;
    std::cout << "READY" << std::endl;
    auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds(4);
    int count = 0;
    while (std::chrono::steady_clock::now() < deadline) {
        pcap_pkthdr *header;
        const u_char *packet;
        int result = pcap_next_ex(handle, &header, &packet);
        if (result == 1) {
            pcap_dump(reinterpret_cast<u_char *>(dump), header, packet);
            ++count;
        } else if (result < 0)
            break;
        else
            std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    pcap_dump_close(dump);
    pcap_close(handle);
    std::cout << "CAPTURED " << count << std::endl;
    return count > 5 ? 0 : 8;
}
