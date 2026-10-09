# 每飛一段就印出電量、高度、朝向
from djitellopy import Tello

tello = Tello()
tello.connect()
tello.takeoff()

def report():
    print("電量", tello.get_battery(), "% ｜高度", tello.get_height(), "cm ｜朝向", tello.get_yaw(), "度")

report()
for i in range(4):
    tello.move_forward(100)
    tello.rotate_clockwise(90)
    report()

tello.land()
