# scotty-gpu pre-migration audit

Date: 2026-05-09 03:38:31 UTC
Host: scotty-gpu
User: john_edge_kavara_ai

## 1. Host and hardware

### `uname -a`
```
Linux scotty-gpu 6.17.0-1012-gcp #12~24.04.1-Ubuntu SMP Fri Mar 27 23:35:04 UTC 2026 x86_64 x86_64 x86_64 GNU/Linux
```

### `cat /etc/os-release`
```
PRETTY_NAME="Ubuntu 24.04.4 LTS"
NAME="Ubuntu"
VERSION_ID="24.04"
VERSION="24.04.4 LTS (Noble Numbat)"
VERSION_CODENAME=noble
ID=ubuntu
ID_LIKE=debian
HOME_URL="https://www.ubuntu.com/"
SUPPORT_URL="https://help.ubuntu.com/"
BUG_REPORT_URL="https://bugs.launchpad.net/ubuntu/"
PRIVACY_POLICY_URL="https://www.ubuntu.com/legal/terms-and-policies/privacy-policy"
UBUNTU_CODENAME=noble
LOGO=ubuntu-logo
```

### `lscpu | head -25`
```
Architecture:                            x86_64
CPU op-mode(s):                          32-bit, 64-bit
Address sizes:                           46 bits physical, 48 bits virtual
Byte Order:                              Little Endian
CPU(s):                                  12
On-line CPU(s) list:                     0-11
Vendor ID:                               GenuineIntel
Model name:                              Intel(R) Xeon(R) CPU @ 2.20GHz
CPU family:                              6
Model:                                   85
Thread(s) per core:                      2
Core(s) per socket:                      6
Socket(s):                               1
Stepping:                                7
BogoMIPS:                                4400.47
Flags:                                   fpu vme de pse tsc msr pae mce cx8 apic sep mtrr pge mca cmov pat pse36 clflush mmx fxsr sse sse2 ss ht syscall nx pdpe1gb rdtscp lm constant_tsc rep_good nopl xtopology nonstop_tsc cpuid tsc_known_freq pni pclmulqdq ssse3 fma cx16 pcid sse4_1 sse4_2 x2apic movbe popcnt aes xsave avx f16c rdrand hypervisor lahf_lm abm 3dnowprefetch ssbd ibrs ibpb stibp ibrs_enhanced fsgsbase tsc_adjust bmi1 hle avx2 smep bmi2 erms invpcid rtm mpx avx512f avx512dq rdseed adx smap clflushopt clwb avx512cd avx512bw avx512vl xsaveopt xsavec xgetbv1 xsaves arat avx512_vnni md_clear arch_capabilities
Hypervisor vendor:                       KVM
Virtualization type:                     full
L1d cache:                               192 KiB (6 instances)
L1i cache:                               192 KiB (6 instances)
L2 cache:                                6 MiB (6 instances)
L3 cache:                                38.5 MiB (1 instance)
NUMA node(s):                            1
NUMA node0 CPU(s):                       0-11
Vulnerability Gather data sampling:      Not affected
```

### `free -h`
```
               total        used        free      shared  buff/cache   available
Mem:            83Gi       2.3Gi        10Gi       1.0Mi        71Gi        81Gi
Swap:             0B          0B          0B
```

### `lsblk --fs`
```
NAME    FSTYPE   FSVER LABEL           UUID                                 FSAVAIL FSUSE% MOUNTPOINTS
loop0   squashfs 4.0                                                              0   100% /snap/core22/2411
loop2   squashfs 4.0                                                              0   100% /snap/snapd/26382
loop3   squashfs 4.0                                                              0   100% /snap/snapd/26865
loop4   squashfs 4.0                                                              0   100% /snap/google-cloud-cli/448
loop5   squashfs 4.0                                                              0   100% /snap/google-cloud-cli/450
sda                                                                                        
├─sda1  ext4     1.0   cloudimg-rootfs 1f81cf12-c68c-4dd7-85f4-ec18e237eee7   98.6G    49% /
├─sda14                                                                                    
├─sda15 vfat     FAT32 UEFI            551C-05A9                              98.2M     6% /boot/efi
└─sda16 ext4     1.0   BOOT            4fcc074b-e84d-4d77-8289-829f3a92076f  698.1M    14% /boot
```

### `mount | grep -vE '^(tmpfs|cgroup|proc|sys|devpts|mqueue|securityfs|debugfs|tracefs|fusectl|configfs|pstore|bpf|none)'`
```
/dev/sda1 on / type ext4 (rw,relatime,discard,errors=remount-ro,commit=30)
devtmpfs on /dev type devtmpfs (rw,nosuid,noexec,relatime,size=43753812k,nr_inodes=10938453,mode=755,inode64)
efivarfs on /sys/firmware/efi/efivars type efivarfs (rw,nosuid,nodev,noexec,relatime)
hugetlbfs on /dev/hugepages type hugetlbfs (rw,nosuid,nodev,relatime,pagesize=2M)
/var/lib/snapd/snaps/core22_2411.snap on /snap/core22/2411 type squashfs (ro,nodev,relatime,errors=continue,threads=single,x-gdu.hide,x-gvfs-hide)
/var/lib/snapd/snaps/snapd_26382.snap on /snap/snapd/26382 type squashfs (ro,nodev,relatime,errors=continue,threads=single,x-gdu.hide,x-gvfs-hide)
/dev/sda16 on /boot type ext4 (rw,relatime)
/dev/sda15 on /boot/efi type vfat (rw,relatime,fmask=0077,dmask=0077,codepage=437,iocharset=iso8859-1,shortname=mixed,errors=remount-ro)
binfmt_misc on /proc/sys/fs/binfmt_misc type binfmt_misc (rw,nosuid,nodev,noexec,relatime)
/var/lib/snapd/snaps/snapd_26865.snap on /snap/snapd/26865 type squashfs (ro,nodev,relatime,errors=continue,threads=single,x-gdu.hide,x-gvfs-hide)
/var/lib/snapd/snaps/google-cloud-cli_448.snap on /snap/google-cloud-cli/448 type squashfs (ro,nodev,relatime,errors=continue,threads=single,x-gdu.hide,x-gvfs-hide)
/var/lib/snapd/snaps/google-cloud-cli_450.snap on /snap/google-cloud-cli/450 type squashfs (ro,nodev,relatime,errors=continue,threads=single,x-gdu.hide,x-gvfs-hide)
```

### `sudo -n dmesg | grep -iE 'tdx|sev-snp|sev|tee|amd_iommu|intel_iommu|secboot' | head -30`
```
```

### `sudo -n dmidecode -t system 2>&1 | head -20`
```
# dmidecode 3.5
Getting SMBIOS data from sysfs.
SMBIOS 2.4 present.

Handle 0x0097, DMI type 1, 27 bytes
System Information
	Manufacturer: Google
	Product Name: Google Compute Engine
	Version: Not Specified
	Serial Number: GoogleCloud-99A24A36AF370371115786491048D98B
	UUID: 99a24a36-af37-0371-1157-86491048d98b
	Wake-up Type: Power Switch
	SKU Number: Not Specified
	Family: Not Specified

Handle 0x0100, DMI type 32, 11 bytes
System Boot Information
	Status: No errors detected

```


## 2. GPU and confidential compute

### `nvidia-smi`
```
Sat May  9 03:38:32 2026       
+-----------------------------------------------------------------------------------------+
| NVIDIA-SMI 580.126.09             Driver Version: 580.126.09     CUDA Version: 13.0     |
+-----------------------------------------+------------------------+----------------------+
| GPU  Name                 Persistence-M | Bus-Id          Disp.A | Volatile Uncorr. ECC |
| Fan  Temp   Perf          Pwr:Usage/Cap |           Memory-Usage | GPU-Util  Compute M. |
|                                         |                        |               MIG M. |
|=========================================+========================+======================|
|   0  NVIDIA A100-SXM4-40GB          Off |   00000000:00:04.0 Off |                    0 |
| N/A   29C    P0             45W /  400W |       0MiB /  40960MiB |      0%      Default |
|                                         |                        |             Disabled |
+-----------------------------------------+------------------------+----------------------+

+-----------------------------------------------------------------------------------------+
| Processes:                                                                              |
|  GPU   GI   CI              PID   Type   Process name                        GPU Memory |
|        ID   ID                                                               Usage      |
|=========================================================================================|
|  No running processes found                                                             |
+-----------------------------------------------------------------------------------------+
```

### `nvidia-smi -L`
```
GPU 0: NVIDIA A100-SXM4-40GB (UUID: GPU-5428af19-1e82-a38c-ee42-cdd3ad745b7e)
```

### `nvidia-smi -q -d MEMORY,UTILIZATION,COMPUTE | head -40`
```

==============NVSMI LOG==============

Timestamp                                              : Sat May  9 03:38:32 2026
Driver Version                                         : 580.126.09
CUDA Version                                           : 13.0

Attached GPUs                                          : 1
GPU 00000000:00:04.0
    FB Memory Usage
        Total                                          : 40960 MiB
        Reserved                                       : 520 MiB
        Used                                           : 0 MiB
        Free                                           : 40441 MiB
    BAR1 Memory Usage
        Total                                          : 65536 MiB
        Used                                           : 1 MiB
        Free                                           : 65535 MiB
    Conf Compute Protected Memory Usage
        Total                                          : 0 MiB
        Used                                           : 0 MiB
        Free                                           : 0 MiB
    Compute Mode                                       : Default
    Utilization
        GPU                                            : 0 %
        Memory                                         : 0 %
        Encoder                                        : 0 %
        Decoder                                        : 0 %
        JPEG                                           : 0 %
        OFA                                            : 0 %
    GPU Utilization Samples
        Duration                                       : 14.06 sec
        Number of Samples                              : 71
        Max                                            : 0 %
        Min                                            : 0 %
        Avg                                            : 0 %
    Memory Utilization Samples
        Duration                                       : 14.06 sec
        Number of Samples                              : 71
        Max                                            : 0 %
```

### `nvidia-smi conf-compute -f 2>&1 || echo 'nvidia-smi conf-compute not supported on this driver/GPU'`
```
CC status: OFF
```

### `lspci | grep -iE 'nvidia|amd|tdx'`
```
00:04.0 3D controller: NVIDIA Corporation GA100 [A100 SXM4 40GB] (rev a1)
```


## 3. Network and firewall

### `ip -br addr`
```
lo               UNKNOWN        127.0.0.1/8 ::1/128 
ens5             UP             10.128.0.16/32 metric 100 fe80::4001:aff:fe80:10/64 
tailscale0       UNKNOWN        100.120.101.79/32 fd7a:115c:a1e0::9c35:654f/128 fe80::c11a:80ac:3697:3e95/64 
```

### `ip route`
```
default via 10.128.0.1 dev ens5 proto dhcp src 10.128.0.16 metric 100 
10.128.0.1 dev ens5 proto dhcp scope link src 10.128.0.16 metric 100 
169.254.169.254 via 10.128.0.1 dev ens5 proto dhcp src 10.128.0.16 metric 100 
```

### `sudo -n iptables -L -n -v | head -60`
```
Chain INPUT (policy ACCEPT 3317K packets, 37G bytes)
 pkts bytes target     prot opt in     out     source               destination         
3328K   37G ts-input   0    --  *      *       0.0.0.0/0            0.0.0.0/0           

Chain FORWARD (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination         
    0     0 ts-forward  0    --  *      *       0.0.0.0/0            0.0.0.0/0           

Chain OUTPUT (policy ACCEPT 0 packets, 0 bytes)
 pkts bytes target     prot opt in     out     source               destination         

Chain ts-forward (1 references)
 pkts bytes target     prot opt in     out     source               destination         
    0     0 MARK       0    --  tailscale0 *       0.0.0.0/0            0.0.0.0/0            MARK xset 0x40000/0xff0000
    0     0 ACCEPT     0    --  *      *       0.0.0.0/0            0.0.0.0/0            mark match 0x40000/0xff0000
    0     0 DROP       0    --  *      tailscale0  100.64.0.0/10        0.0.0.0/0           
    0     0 ACCEPT     0    --  *      tailscale0  0.0.0.0/0            0.0.0.0/0           

Chain ts-input (1 references)
 pkts bytes target     prot opt in     out     source               destination         
    0     0 ACCEPT     0    --  lo     *       100.120.101.79       0.0.0.0/0           
    0     0 RETURN     0    --  !tailscale0 *       100.115.92.0/23      0.0.0.0/0           
    0     0 DROP       0    --  !tailscale0 *       100.64.0.0/10        0.0.0.0/0           
 2790 3997K ACCEPT     0    --  tailscale0 *       0.0.0.0/0            0.0.0.0/0           
 7978 4913K ACCEPT     17   --  *      *       0.0.0.0/0            0.0.0.0/0            udp dpt:41641
```

### `sudo -n nft list ruleset 2>/dev/null | head -60 || echo 'nft not present or no ruleset'`
```
table ip filter {
	chain ts-input {
		ip saddr 100.120.101.79 iifname "lo" counter packets 0 bytes 0 accept
		ip saddr 100.115.92.0/23 iifname != "tailscale0" counter packets 0 bytes 0 return
		ip saddr 100.64.0.0/10 iifname != "tailscale0" counter packets 0 bytes 0 drop
		iifname "tailscale0" counter packets 2790 bytes 3996532 accept
		udp dport 41641 counter packets 7978 bytes 4912948 accept
	}

	chain ts-forward {
		iifname "tailscale0" counter packets 0 bytes 0 meta mark set mark and 0xff00ffff xor 0x40000
		meta mark & 0x00ff0000 == 0x00040000 counter packets 0 bytes 0 accept
		ip saddr 100.64.0.0/10 oifname "tailscale0" counter packets 0 bytes 0 drop
		oifname "tailscale0" counter packets 0 bytes 0 accept
	}

	chain INPUT {
		type filter hook input priority filter; policy accept;
		counter packets 3328135 bytes 36832614464 jump ts-input
	}

	chain FORWARD {
		type filter hook forward priority filter; policy accept;
		counter packets 0 bytes 0 jump ts-forward
	}
}
table ip nat {
	chain ts-postrouting {
		meta mark & 0x00ff0000 == 0x00040000 counter packets 0 bytes 0 masquerade
	}

	chain POSTROUTING {
		type nat hook postrouting priority srcnat; policy accept;
		counter packets 15078 bytes 1082043 jump ts-postrouting
	}
}
table ip6 filter {
	chain ts-input {
		ip6 saddr fd7a:115c:a1e0::9c35:654f iifname "lo" counter packets 0 bytes 0 accept
		iifname "tailscale0" counter packets 0 bytes 0 accept
		udp dport 41641 counter packets 0 bytes 0 accept
	}

	chain ts-forward {
		iifname "tailscale0" counter packets 0 bytes 0 meta mark set mark and 0xff00ffff xor 0x40000
		meta mark & 0x00ff0000 == 0x00040000 counter packets 0 bytes 0 accept
		oifname "tailscale0" counter packets 0 bytes 0 accept
	}

	chain INPUT {
		type filter hook input priority filter; policy accept;
		counter packets 0 bytes 0 jump ts-input
	}

	chain FORWARD {
		type filter hook forward priority filter; policy accept;
		counter packets 0 bytes 0 jump ts-forward
	}
}
table ip6 nat {
```

### `ss -tlnp 2>&1 | head -30`
```
State  Recv-Q Send-Q               Local Address:Port  Peer Address:PortProcess
LISTEN 0      4096                 127.0.0.53%lo:53         0.0.0.0:*          
LISTEN 0      4096                    127.0.0.54:53         0.0.0.0:*          
LISTEN 0      4096                100.120.101.79:41753      0.0.0.0:*          
LISTEN 0      4096                       0.0.0.0:22         0.0.0.0:*          
LISTEN 0      4096   [fd7a:115c:a1e0::9c35:654f]:48522         [::]:*          
LISTEN 0      4096                             *:11434            *:*          
LISTEN 0      4096                          [::]:22            [::]:*          
```

### `cat /etc/resolv.conf`
```
# This is /run/systemd/resolve/stub-resolv.conf managed by man:systemd-resolved(8).
# Do not edit.
#
# This file might be symlinked as /etc/resolv.conf. If you're looking at
# /etc/resolv.conf and seeing this text, you have followed the symlink.
#
# This is a dynamic resolv.conf file for connecting local clients to the
# internal DNS stub resolver of systemd-resolved. This file lists all
# configured search domains.
#
# Run "resolvectl status" to see details about the uplink DNS servers
# currently in use.
#
# Third party programs should typically not access this file directly, but only
# through the symlink at /etc/resolv.conf. To manage man:resolv.conf(5) in a
# different way, replace this symlink by a static file or a different symlink.
#
# See man:systemd-resolved.service(8) for details about the supported modes of
# operation for /etc/resolv.conf.

nameserver 127.0.0.53
options edns0 trust-ad
search us-central1-a.c.office-of-cto-491318.internal c.office-of-cto-491318.internal google.internal ibis-allosaurus.ts.net kavara.ai
```

### Egress probes (should fail under deny-all-egress)
```
https://www.google.com -> 200
https://api.anthropic.com -> 404
https://api.openai.com -> 421
https://huggingface.co -> 200
```

## 4. Currently running AI stack

### `which ollama`
```
/usr/local/bin/ollama
```

### `ollama list 2>&1 || echo 'ollama not installed or not running'`
```
NAME                          ID              SIZE      MODIFIED    
qwen2.5-coder:32b-instruct    b92d6a0bd47e    19 GB     3 days ago     
gemma4:26b                    5571076f3d70    17 GB     3 weeks ago    
gemma4:31b                    6316f0629137    19 GB     3 weeks ago    
gemma3:12b                    f4031aab637d    8.1 GB    3 weeks ago    
```

### `systemctl status ollama --no-pager 2>&1 | head -20 || true`
```
● ollama.service - Ollama Service
     Loaded: loaded (/etc/systemd/system/ollama.service; enabled; preset: enabled)
    Drop-In: /etc/systemd/system/ollama.service.d
             └─override.conf
     Active: active (running) since Sun 2026-05-03 12:50:52 UTC; 5 days ago
   Main PID: 732 (ollama)
      Tasks: 25 (limit: 102480)
     Memory: 45.5G (peak: 46.1G)
        CPU: 5h 30min 30.343s
     CGroup: /system.slice/ollama.service
             └─732 /usr/local/bin/ollama serve
```

### `ps auxf | grep -iE 'ollama|scotty|gemma|vllm|tgi|llama' | grep -v grep | head -20`
```
ollama       732  0.1  0.1 3248872 93396 ?       Ssl  May03   9:12 /usr/local/bin/ollama serve
john_ed+   80796  0.0  0.0   6128  1980 pts/0    S+   03:38   0:00                  \_ tee /tmp/scotty-gpu-premigration-audit.md
```

### `ls -lh /usr/share/ollama/.ollama/models 2>/dev/null || ls -lh ~/.ollama/models 2>/dev/null || echo 'no ollama models dir found'`
```
total 8.0K
drwxr-xr-x 2 ollama ollama 4.0K May  5 19:33 blobs
drwxr-xr-x 3 ollama ollama 4.0K Apr 16 03:14 manifests
```


## 5. Filesystem and code surface (directory listings only — no file contents)

### `ls -lah ~/`
```
total 160K
drwxr-x--- 15 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  5 20:42 .
drwxr-xr-x  4 root                root                4.0K Apr 16 02:58 ..
-rw-------  1 john_edge_kavara_ai john_edge_kavara_ai  42K May  5 20:43 .bash_history
-rw-r--r--  1 john_edge_kavara_ai john_edge_kavara_ai  220 Apr 16 02:58 .bash_logout
-rw-r--r--  1 john_edge_kavara_ai john_edge_kavara_ai 3.7K Apr 16 02:58 .bashrc
drwx------  5 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  4 18:11 .cache
drwxrwxr-x 13 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  5 20:20 .claude
-rw-------  1 john_edge_kavara_ai john_edge_kavara_ai  26K May  5 20:42 .claude.json
drwxrwxr-x  5 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  4 17:32 .config
drwxrwxr-x  8 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 16 14:19 .git
drwxrwxr-x  2 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 16 03:39 .git-hooks
-rw-rw-r--  1 john_edge_kavara_ai john_edge_kavara_ai  298 May  4 17:25 .gitconfig
-rw-rw-r--  1 john_edge_kavara_ai john_edge_kavara_ai  132 Apr 16 03:39 .gitignore_global
-rw-------  1 john_edge_kavara_ai john_edge_kavara_ai   20 May  4 17:25 .lesshst
drwxrwxr-x  3 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 17 02:19 .local
drwxrwxr-x  5 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  4 17:31 .npm
drwx------  3 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  4 17:29 .nv
drwxr-xr-x  2 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 17 01:42 .ollama
-rw-r--r--  1 john_edge_kavara_ai john_edge_kavara_ai  807 Apr 16 02:58 .profile
drwxrwxr-x  3 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 16 05:07 scotty
drwx------  3 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 16 02:59 snap
drwxrwxr-x  5 john_edge_kavara_ai john_edge_kavara_ai 4.0K Apr 29 16:56 stac-venv
drwxrwxr-x 18 john_edge_kavara_ai john_edge_kavara_ai 4.0K May  4 22:34 wonderwall
```

### `ls -lah /opt 2>/dev/null`
```
total 8.0K
drwxr-xr-x  2 root root 4.0K Apr  2 07:02 .
drwxr-xr-x 22 root root 4.0K May  3 12:50 ..
```

### `ls -lah /mnt 2>/dev/null`
```
total 8.0K
drwxr-xr-x  2 root root 4.0K Apr  2 07:02 .
drwxr-xr-x 22 root root 4.0K May  3 12:50 ..
```

### `df -h | grep -vE '^tmpfs|^udev|^/dev/loop'`
```
Filesystem      Size  Used Avail Use% Mounted on
/dev/root       193G   95G   99G  49% /
efivarfs        256K   32K  220K  13% /sys/firmware/efi/efivars
/dev/sda16      881M  121M  699M  15% /boot
/dev/sda15      105M  6.2M   99M   6% /boot/efi
```

### `find ~/ -maxdepth 3 -type d 2>/dev/null | head -30`
```
/home/john_edge_kavara_ai/
/home/john_edge_kavara_ai/snap
/home/john_edge_kavara_ai/snap/google-cloud-cli
/home/john_edge_kavara_ai/snap/google-cloud-cli/450
/home/john_edge_kavara_ai/snap/google-cloud-cli/common
/home/john_edge_kavara_ai/snap/google-cloud-cli/448
/home/john_edge_kavara_ai/.local
/home/john_edge_kavara_ai/.local/share
/home/john_edge_kavara_ai/.local/share/nano
/home/john_edge_kavara_ai/.local/share/applications
/home/john_edge_kavara_ai/.ollama
/home/john_edge_kavara_ai/.config
/home/john_edge_kavara_ai/.config/git
/home/john_edge_kavara_ai/.config/gh
/home/john_edge_kavara_ai/.config/gcloud
/home/john_edge_kavara_ai/.config/gcloud/configurations
/home/john_edge_kavara_ai/.config/gcloud/logs
/home/john_edge_kavara_ai/stac-venv
/home/john_edge_kavara_ai/stac-venv/bin
/home/john_edge_kavara_ai/stac-venv/include
/home/john_edge_kavara_ai/stac-venv/include/python3.12
/home/john_edge_kavara_ai/stac-venv/lib
/home/john_edge_kavara_ai/stac-venv/lib/python3.12
/home/john_edge_kavara_ai/.claude
/home/john_edge_kavara_ai/.claude/backups
/home/john_edge_kavara_ai/.claude/projects
/home/john_edge_kavara_ai/.claude/projects/-home-john-edge-kavara-ai-wonderwall
/home/john_edge_kavara_ai/.claude/cache
/home/john_edge_kavara_ai/.claude/sessions
/home/john_edge_kavara_ai/.claude/telemetry
```

### Git repos found (remotes only, no source)
```
--- /home/john_edge_kavara_ai ---
83e9841 scotty: update kirk-adapter/benchmarks/accuracy_validation.py
ad64a7c scotty: auto-commit 3 file(s)
cdc125f scotty: update kirk-adapter/benchmarks/benchmark_sweep.py
--- /home/john_edge_kavara_ai/scotty ---
origin	https://ghp_REDACTED_ROTATE_THIS_TOKEN@github.com/UlyssesModel/scotty.git (fetch)
origin	https://ghp_REDACTED_ROTATE_THIS_TOKEN@github.com/UlyssesModel/scotty.git (push)
ec4db3d v6.2: anti-hallucination prompt + temperature 0.2
1706b17 Initial release — Scotty v0.2.0
--- /home/john_edge_kavara_ai/wonderwall ---
origin	https://github.com/UlyssesModel/wonderwall.git (fetch)
origin	https://github.com/UlyssesModel/wonderwall.git (push)
5189263 docs: capture v0.1 plumbing-validation results from 2026-05-04 demo run
efb04fd injection: cast inputs_embeds to model dtype in generate_with_embeds
187c173 adapter: co-locate Kirk-output inputs with adapter weights in embed_kirk_output
```

## 6. IAM, snapshots, and CMEK

### `gcloud auth list 2>&1`
```
                  Credentialed Accounts
ACTIVE  ACCOUNT
*       578895797177-compute@developer.gserviceaccount.com

To set the active account, run:
    $ gcloud config set account `ACCOUNT`

```

### `gcloud config list 2>&1`
```
[core]
account = 578895797177-compute@developer.gserviceaccount.com
disable_usage_reporting = True
project = office-of-cto-491318
universe_domain = googleapis.com
[metrics]
environment = snap_google_cloud_cli_amd64

Your active configuration is: [default]
```

### `gcloud compute instances describe scotty-gpu --zone=us-central1-a --format='value(machineType.basename(),cpuPlatform,confidentialInstanceConfig,serviceAccounts)' 2>&1`
```
ERROR: (gcloud.compute.instances.describe) Could not fetch resource:
 - Request had insufficient authentication scopes.

```

### `gcloud compute disks list --filter='zone~us-central1-a' --format='table(name,sizeGb,type.basename(),diskEncryptionKey.kmsKeyName)' 2>&1`
```
WARNING: Some requests did not succeed.
 - Request had insufficient authentication scopes.

WARNING: The following filter keys were not present in any resource : zone
```

### `gcloud compute snapshots list --filter='sourceDisk~scotty-gpu OR sourceDisk~kirk-model' --format='table(name,creationTimestamp,sourceDisk.basename(),storageBytes)' 2>&1`
```
ERROR: (gcloud.compute.snapshots.list) Some requests did not succeed:
 - Request had insufficient authentication scopes.

```

### `gcloud kms keys list --location=us-central1 --keyring=kirk-keyring 2>&1 || echo 'kirk-keyring not found in us-central1'`
```
ERROR: (gcloud.kms.keys.list) PERMISSION_DENIED: Request had insufficient authentication scopes. This command is authenticated as 578895797177-compute@developer.gserviceaccount.com which is the active account specified by the [core/account] property.
- '@type': type.googleapis.com/google.rpc.ErrorInfo
  domain: googleapis.com
  metadata:
    method: google.cloud.kms.v1.KeyManagementService.ListCryptoKeys
    service: cloudkms.googleapis.com
  reason: ACCESS_TOKEN_SCOPE_INSUFFICIENT

If you are in a compute engine VM, it is likely that the specified scopes during VM creation are not enough to run this command.
See https://cloud.google.com/compute/docs/access/service-accounts#accesscopesiam for more information about access scopes.
See https://cloud.google.com/compute/docs/access/create-enable-service-accounts-for-instances#changeserviceaccountandscopes for how to update access scopes of the VM.
kirk-keyring not found in us-central1
```


---
Audit complete. Output saved to: /tmp/scotty-gpu-premigration-audit.md
