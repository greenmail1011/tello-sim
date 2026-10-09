# 每次往前 50、往上 30，像爬樓梯
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

for step in range(5):
    print("第", step + 1, "階")
    tello.move_forward(50)
    tello.move_up(30)

tello.land()
