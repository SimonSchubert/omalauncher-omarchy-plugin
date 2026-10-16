FROM archlinux:latest
# The sandbox needs syscalls an emulated amd64 container doesn't have.
RUN sed -i 's/^\[options\]/[options]\nDisableSandbox/' /etc/pacman.conf \
 && pacman -Syu --noconfirm python base-devel quickshell qt6-imageformats sway grim wtype ttf-jetbrains-mono-nerd jq curl git perl qrencode \
 && pacman -Scc --noconfirm
